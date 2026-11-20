mod db;

use db::{
    CharacterRow, CharacterStats, Context, Field, Meta, PostArrays, Preset, Suggestion, TagDb,
};
use flate2::read::{DeflateDecoder, GzDecoder};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::io::Read;
use std::sync::OnceLock;

const TAGS_JSON: &[u8] = include_bytes!("data/tags.json.gz");
const CHARACTERS_JSON: &[u8] = include_bytes!("data/characters.json.gz");
const CHARACTER_TAGS_NPZ: &[u8] = include_bytes!("data/character_tags.npz");
const POSTS_NPZ: &[u8] = include_bytes!("data/posts.npz");
const ZIP_LOCAL_HEADER: &[u8] = b"PK\x03\x04";
const ZIP_DEFLATE: usize = 8;

static DB: OnceLock<Result<TagDb, String>> = OnceLock::new();

// Embedded data decoding
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

fn load_posts() -> Result<PostArrays, String> {
    Ok(PostArrays {
        indptr: npz_array(POSTS_NPZ, "indptr", u32::from_le_bytes)?,
        tags: npz_array(POSTS_NPZ, "tags", u16::from_le_bytes)?,
        rating: npz_array(POSTS_NPZ, "rating", u8::from_le_bytes)?,
    })
}

fn load_embedded() -> Result<TagDb, String> {
    let meta: Meta = gunzip_json(TAGS_JSON)?;
    let characters: Vec<CharacterRow> = gunzip_json(CHARACTERS_JSON)?;
    let stats = CharacterStats {
        indptr: npz_array(CHARACTER_TAGS_NPZ, "indptr", u32::from_le_bytes)?,
        tags: npz_array(CHARACTER_TAGS_NPZ, "tags", u16::from_le_bytes)?,
        percent: npz_array(CHARACTER_TAGS_NPZ, "percent", u8::from_le_bytes)?,
    };
    Ok(TagDb::from_parts(
        meta,
        characters,
        stats,
        Box::new(load_posts),
    ))
}

fn db() -> Result<&'static TagDb, String> {
    DB.get_or_init(load_embedded).as_ref().map_err(Clone::clone)
}

// Commands
#[tauri::command(async)]
pub fn character_data_fields() -> Result<Vec<Field>, String> {
    Ok(db()?.fields().to_vec())
}

#[tauri::command(async)]
pub fn character_data_autocomplete(
    field: String,
    query: String,
    limit: usize,
) -> Result<Vec<Suggestion>, String> {
    Ok(db()?.autocomplete(&field, &query, limit))
}

#[tauri::command(async)]
pub fn character_data_suggest(
    field: String,
    context: Context,
    limit: usize,
    rating: String,
) -> Result<Vec<Suggestion>, String> {
    db()?.suggest(&field, &context, limit, &rating)
}

#[tauri::command(async)]
pub fn character_data_preset(name: String) -> Result<Option<Preset>, String> {
    Ok(db()?.character_preset(&name))
}

#[tauri::command(async)]
pub fn character_data_randomize(
    fields: Vec<String>,
    counts: HashMap<String, i64>,
    context: Context,
    rating: String,
    seed: Option<u64>,
    require: Vec<String>,
) -> Result<HashMap<String, Vec<String>>, String> {
    db()?.randomize(&fields, &counts, &context, &rating, seed, &require)
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

    #[test]
    fn npy_payload_rejects_other_data() {
        assert!(npy_payload(b"PK\x03\x04 not numpy").is_err());
    }
}
