mod db;
pub mod rebuild;

use db::{
    CharacterRow, CharacterStats, Context, Field, Meta, PostArrays, Preset, Suggestion, TagDb,
};
use flate2::read::{DeflateDecoder, GzDecoder};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use tauri::AppHandle;

const TAGS_JSON: &str = "tags.json.gz";
const CHARACTERS_JSON: &str = "characters.json.gz";
const CHARACTER_TAGS_NPZ: &str = "character_tags.npz";
const POSTS_NPZ: &str = "posts.npz";
const DATA_FILES: [&str; 4] = [TAGS_JSON, CHARACTERS_JSON, CHARACTER_TAGS_NPZ, POSTS_NPZ];
const NO_DATASET: &str =
    "Character Helper has no dataset yet. Build it in Settings > Character Helper.";
const ZIP_LOCAL_HEADER: &[u8] = b"PK\x03\x04";
const ZIP_DEFLATE: usize = 8;

static DB: Mutex<Option<Arc<TagDb>>> = Mutex::new(None);

// Data file decoding
fn gunzip_json<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_reader(GzDecoder::new(bytes)).map_err(|e| e.to_string())
}

fn le_u16(bytes: &[u8], at: usize) -> usize {
    u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize
}

fn npz_entry(npz: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let wanted = format!("{name}.npy");
    let header = (0..npz.len().saturating_sub(30))
        .filter(|&i| npz[i..].starts_with(ZIP_LOCAL_HEADER))
        .find(|&i| {
            let name_len = le_u16(npz, i + 26);
            npz.get(i + 30..i + 30 + name_len) == Some(wanted.as_bytes())
        })
        .ok_or_else(|| format!("{wanted} missing from character data"))?;
    if le_u16(npz, header + 8) != ZIP_DEFLATE {
        return Err(format!("{wanted} is not deflate-compressed"));
    }
    let start = header + 30 + le_u16(npz, header + 26) + le_u16(npz, header + 28);
    let mut out = Vec::new();
    DeflateDecoder::new(&npz[start..])
        .read_to_end(&mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn npy_payload(npy: &[u8]) -> Result<&[u8], String> {
    if !npy.starts_with(b"\x93NUMPY") || npy.len() < 12 {
        return Err("Invalid .npy data".into());
    }
    let start = match npy[6] {
        1 => 10 + le_u16(npy, 8),
        _ => 12 + u32::from_le_bytes([npy[8], npy[9], npy[10], npy[11]]) as usize,
    };
    npy.get(start..).ok_or_else(|| "Truncated .npy data".into())
}

fn npz_array<T, const N: usize>(
    npz: &[u8],
    name: &str,
    from: fn([u8; N]) -> T,
) -> Result<Vec<T>, String> {
    let npy = npz_entry(npz, name)?;
    Ok(npy_payload(&npy)?
        .chunks_exact(N)
        .map(|c| from(c.try_into().expect("chunk size")))
        .collect())
}

fn read_data(dir: &Path, name: &str) -> Result<Vec<u8>, String> {
    fs::read(dir.join(name)).map_err(|e| format!("{name}: {e}"))
}

fn load_posts(npz: &[u8]) -> Result<PostArrays, String> {
    Ok(PostArrays {
        indptr: npz_array(npz, "indptr", u32::from_le_bytes)?,
        tags: npz_array(npz, "tags", u16::from_le_bytes)?,
        rating: npz_array(npz, "rating", u8::from_le_bytes)?,
    })
}

fn check_csr(name: &str, indptr: &[u32], rows: usize, values: usize) -> Result<(), String> {
    let consistent = indptr.len() == rows + 1
        && indptr.last().is_some_and(|&end| end as usize == values)
        && indptr.windows(2).all(|w| w[0] <= w[1]);
    consistent
        .then_some(())
        .ok_or_else(|| format!("{name} does not match the other data files"))
}

fn check_ids<'a>(
    name: &str,
    ids: impl IntoIterator<Item = &'a usize>,
    limit: usize,
) -> Result<(), String> {
    match ids.into_iter().find(|&&id| id >= limit) {
        Some(id) => Err(format!(
            "{name} refers to tag {id}, but only {limit} tags exist"
        )),
        None => Ok(()),
    }
}

fn check_parts(
    meta: &Meta,
    characters: &[CharacterRow],
    stats: &CharacterStats,
    posts: &PostArrays,
) -> Result<(), String> {
    let tag_count = meta.tags.len();
    if meta.fields.is_empty() || tag_count == 0 || tag_count > usize::from(u16::MAX) + 1 {
        return Err(format!("{TAGS_JSON} has no fields or an invalid tag count"));
    }
    if let Some((name, ..)) = meta.tags.iter().find(|t| t.1 >= meta.fields.len()) {
        return Err(format!("{TAGS_JSON}: tag {name} has no field"));
    }
    check_ids(TAGS_JSON, meta.implies.values().flatten(), tag_count)?;
    check_ids(
        TAGS_JSON,
        meta.groups
            .values()
            .flat_map(|g| g.tags.iter().chain(&g.multi)),
        tag_count,
    )?;
    check_ids(TAGS_JSON, &meta.soft, tag_count)?;
    check_csr(
        CHARACTER_TAGS_NPZ,
        &stats.indptr,
        characters.len(),
        stats.tags.len(),
    )?;
    if stats.percent.len() != stats.tags.len() {
        return Err(format!("{CHARACTER_TAGS_NPZ} has mismatched arrays"));
    }
    check_csr(
        POSTS_NPZ,
        &posts.indptr,
        posts.rating.len(),
        posts.tags.len(),
    )?;
    let largest = stats
        .tags
        .iter()
        .chain(&posts.tags)
        .max()
        .map(|&t| t as usize);
    check_ids("character and post data", &largest, tag_count)
}

fn load(dir: PathBuf) -> Result<TagDb, String> {
    let meta: Meta = gunzip_json(&read_data(&dir, TAGS_JSON)?)?;
    let characters: Vec<CharacterRow> = gunzip_json(&read_data(&dir, CHARACTERS_JSON)?)?;
    let stats_npz = read_data(&dir, CHARACTER_TAGS_NPZ)?;
    let stats = CharacterStats {
        indptr: npz_array(&stats_npz, "indptr", u32::from_le_bytes)?,
        tags: npz_array(&stats_npz, "tags", u16::from_le_bytes)?,
        percent: npz_array(&stats_npz, "percent", u8::from_le_bytes)?,
    };
    let posts = load_posts(&read_data(&dir, POSTS_NPZ)?)?;
    check_parts(&meta, &characters, &stats, &posts)?;
    Ok(TagDb::from_parts(meta, characters, stats, posts))
}

pub(crate) fn installed_dir(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let dir = rebuild::data_dir(app)?;
    let complete = DATA_FILES.iter().all(|name| dir.join(name).is_file());
    Ok(complete.then_some(dir))
}

pub(crate) fn validate(dir: &Path) -> Result<(), String> {
    load(dir.to_path_buf()).map(drop)
}

fn db(app: &AppHandle) -> Result<Arc<TagDb>, String> {
    let mut slot = DB.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(db) = slot.as_ref() {
        return Ok(db.clone());
    }
    let dir = installed_dir(app)?.ok_or(NO_DATASET)?;
    let loaded = Arc::new(load(dir).map_err(|e| {
        format!(
            "The Character Helper dataset could not be read ({e}). Rebuild it in Settings > Character Helper."
        )
    })?);
    *slot = Some(loaded.clone());
    Ok(loaded)
}

fn reset() {
    DB.lock().unwrap_or_else(PoisonError::into_inner).take();
}

// Commands
#[tauri::command(async)]
pub fn character_data_fields(app: AppHandle) -> Result<Vec<Field>, String> {
    Ok(db(&app)?.fields().to_vec())
}

#[tauri::command(async)]
pub fn character_data_autocomplete(
    app: AppHandle,
    field: String,
    query: String,
    limit: usize,
) -> Result<Vec<Suggestion>, String> {
    Ok(db(&app)?.autocomplete(&field, &query, limit))
}

#[tauri::command(async)]
pub fn character_data_suggest(
    app: AppHandle,
    field: String,
    context: Context,
    limit: usize,
    rating: String,
) -> Result<Vec<Suggestion>, String> {
    db(&app)?.suggest(&field, &context, limit, &rating)
}

#[tauri::command(async)]
pub fn character_data_preset(app: AppHandle, name: String) -> Result<Option<Preset>, String> {
    Ok(db(&app)?.character_preset(&name))
}

#[tauri::command(async)]
pub fn character_data_randomize(
    app: AppHandle,
    fields: Vec<String>,
    counts: HashMap<String, i64>,
    context: Context,
    rating: String,
    seed: Option<u64>,
    require: Vec<String>,
) -> Result<HashMap<String, Vec<String>>, String> {
    db(&app)?.randomize(&fields, &counts, &context, &rating, seed, &require)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn npy_v1(header: &str, payload: &[u8]) -> Vec<u8> {
        let mut out = b"\x93NUMPY\x01\x00".to_vec();
        out.extend((header.len() as u16).to_le_bytes());
        out.extend(header.as_bytes());
        out.extend(payload);
        out
    }

    #[test]
    fn npy_payload_skips_v1_header() {
        let npy = npy_v1("{'descr': '<u2'}\n", &[1, 0, 2, 0]);
        let values: Vec<u16> = npy_payload(&npy)
            .unwrap()
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(values, [1, 2]);
    }

    fn parts() -> (Meta, Vec<CharacterRow>, CharacterStats, PostArrays) {
        let meta = serde_json::from_value(serde_json::json!({
            "built": "2026-11-23",
            "fields": [{ "id": "hair", "label": "hair", "count": 1, "group": "looks" }],
            "tags": [["long_hair", 0, 10, 0.0], ["short_hair", 0, 5, 0.0]],
            "implies": { "1": [0] },
            "groups": { "hair_length": { "tags": [0, 1], "multi": [] } },
            "soft": [],
            "colors": [],
            "aliases": {},
            "series": []
        }))
        .unwrap();
        let characters = vec![("miku".into(), 10, "vocaloid".into(), vec![], 1)];
        let stats = CharacterStats {
            indptr: vec![0, 2],
            tags: vec![0, 1],
            percent: vec![90, 40],
        };
        let posts = PostArrays {
            indptr: vec![0, 1, 2],
            tags: vec![0, 1],
            rating: vec![0, 1],
        };
        (meta, characters, stats, posts)
    }

    #[test]
    fn consistent_data_passes_the_check() {
        let (meta, characters, stats, posts) = parts();
        check_parts(&meta, &characters, &stats, &posts).unwrap();
    }

    #[test]
    fn consistency_check_rejects_unknown_tag_ids() {
        let (meta, characters, stats, mut posts) = parts();
        posts.tags[0] = 7;
        let error = check_parts(&meta, &characters, &stats, &posts).unwrap_err();
        assert!(error.contains("only 2 tags exist"), "{error}");
    }

    #[test]
    fn consistency_check_rejects_mismatched_offsets() {
        let (meta, characters, mut stats, posts) = parts();
        stats.indptr = vec![0, 1];
        let error = check_parts(&meta, &characters, &stats, &posts).unwrap_err();
        assert!(error.contains(CHARACTER_TAGS_NPZ), "{error}");
    }

    #[test]
    fn npy_payload_rejects_other_data() {
        assert!(npy_payload(b"PK\x03\x04 not numpy").is_err());
    }
}
