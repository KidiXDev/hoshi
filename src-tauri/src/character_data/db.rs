use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Mutex, OnceLock, PoisonError};

// Preset and dice rules
const PRESET_RULES: [(&str, u8, f64, usize); 13] = [
    ("subject", 30, 0.0, 2),
    ("hair", 28, 0.0, 5),
    ("eyes", 28, 0.0, 2),
    ("body", 30, 0.0, 4),
    ("outfit", 15, 0.40, 3),
    ("top", 10, 0.30, 8),
    ("bottom", 10, 0.35, 4),
    ("legwear", 10, 0.35, 4),
    ("accessories", 10, 0.30, 6),
    ("expression", 20, 0.0, 1),
    ("pose", 15, 0.0, 2),
    ("view", 15, 0.0, 1),
    ("background", 15, 0.0, 2),
];
const PRESET_FALLBACK_PERCENT: [(&str, u8); 2] = [("hair", 8), ("eyes", 8)];
const IDENTITY_FIELDS: [&str; 4] = ["subject", "hair", "eyes", "body"];
const GARMENT_FIELDS: [&str; 3] = ["outfit", "top", "bottom"];
pub const RATINGS: [&str; 4] = ["general", "sensitive", "questionable", "explicit"];
const DEFAULT_RATING_LEVEL: u8 = 1;
const RANDOM_MIN_COUNT: u64 = 1000;
const REQUIRE_PERCENT: u8 = 30;
const POOL_FULL_MIN: usize = 200;
const CHARACTER: &str = "character";

pub type Context = BTreeMap<String, Vec<String>>;

// Raw data shapes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field {
    pub id: String,
    pub label: String,
    pub count: i64,
    pub group: String,
}

#[derive(Deserialize)]
pub struct GroupRow {
    pub tags: Vec<usize>,
    pub multi: Vec<usize>,
}

#[derive(Deserialize)]
pub struct Meta {
    #[serde(default)]
    pub built: Option<String>,
    pub fields: Vec<Field>,
    pub tags: Vec<(String, usize, u64, f32)>,
    pub implies: HashMap<String, Vec<usize>>,
    pub groups: HashMap<String, GroupRow>,
    pub soft: Vec<usize>,
    pub colors: Vec<String>,
    pub aliases: HashMap<String, Vec<String>>,
    pub series: Vec<(String, u64)>,
}

pub type CharacterRow = (String, u64, String, Vec<String>, u8);

pub struct CharacterStats {
    pub indptr: Vec<u32>,
    pub tags: Vec<u16>,
    pub percent: Vec<u8>,
}

#[derive(Default)]
pub struct PostArrays {
    pub indptr: Vec<u32>,
    pub tags: Vec<u16>,
    pub rating: Vec<u8>,
}

// Results
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Suggestion {
    pub tag: String,
    pub count: u64,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Preset {
    pub character: String,
    pub series: String,
    pub count: u64,
    pub fields: HashMap<String, Vec<String>>,
}

struct Tag {
    name: String,
    field: usize,
    count: u64,
    nsfw: f32,
}

struct Character {
    name: String,
    count: u64,
    series: String,
    aliases: Vec<String>,
    clean: bool,
}

struct Group {
    tags: HashSet<usize>,
    multi: HashSet<usize>,
}

struct Pool {
    indptr: Vec<usize>,
    tags: Vec<u16>,
    rating: Vec<u8>,
    inv_posts: Vec<u32>,
    inv_ptr: Vec<usize>,
    idf: Vec<f32>,
    field_count: Vec<Vec<u8>>,
}

impl Pool {
    fn build(posts: PostArrays, tag_count: usize, tag_field: &[usize], field_count: usize) -> Self {
        let indptr: Vec<usize> = posts.indptr.iter().map(|&i| i as usize).collect();
        let n = indptr.len().saturating_sub(1);
        let mut df = vec![0usize; tag_count];
        for &t in &posts.tags {
            df[t as usize] += 1;
        }
        let mut inv_ptr = vec![0usize; tag_count + 1];
        for t in 0..tag_count {
            inv_ptr[t + 1] = inv_ptr[t] + df[t];
        }
        let mut fill = inv_ptr.clone();
        let mut inv_posts = vec![0u32; posts.tags.len()];
        let mut per_field = vec![vec![0u8; n]; field_count];
        for p in 0..n {
            for &t in &posts.tags[indptr[p]..indptr[p + 1]] {
                let t = t as usize;
                inv_posts[fill[t]] = p as u32;
                fill[t] += 1;
                let slot = &mut per_field[tag_field[t]][p];
                *slot = slot.saturating_add(1);
            }
        }
        let idf = df
            .iter()
            .map(|&d| ((n as f64 + 1.0) / (d as f64 + 1.0)).ln() as f32)
            .collect();
        Self {
            indptr,
            tags: posts.tags,
            rating: posts.rating,
            inv_posts,
            inv_ptr,
            idf,
            field_count: per_field,
        }
    }

    fn len(&self) -> usize {
        self.rating.len()
    }

    fn post_tags(&self, p: usize) -> &[u16] {
        &self.tags[self.indptr[p]..self.indptr[p + 1]]
    }

    fn posts_with(&self, tag: usize) -> &[u32] {
        &self.inv_posts[self.inv_ptr[tag]..self.inv_ptr[tag + 1]]
    }
}

// Seeded random source (SplitMix64)
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: Option<u64>) -> Self {
        Self(seed.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0)
        }))
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, n: usize) -> usize {
        ((self.unit() * n as f64) as usize).min(n.saturating_sub(1))
    }

    fn weighted(&mut self, weights: &[f64]) -> usize {
        let total: f64 = weights.iter().sum();
        let mut x = self.unit() * total;
        let mut last = 0;
        for (i, &w) in weights.iter().enumerate() {
            if w <= 0.0 {
                continue;
            }
            if x < w {
                return i;
            }
            x -= w;
            last = i;
        }
        last
    }

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i + 1);
            items.swap(i, j);
        }
    }
}

pub fn rating_level(rating: &str) -> u8 {
    RATINGS
        .iter()
        .position(|r| *r == rating)
        .map_or(DEFAULT_RATING_LEVEL, |i| i as u8)
}

fn is_weight_number(text: &str) -> bool {
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    let number = text.trim_start();
    let number = number.strip_prefix('-').unwrap_or(number);
    match number.split_once('.') {
        Some((whole, fraction)) => digits(whole) && !fraction.is_empty() && digits(fraction),
        None => !number.is_empty() && digits(number),
    }
}

fn strip_weight(tag: &str) -> &str {
    let Some(inner) = tag.strip_prefix('(').and_then(|t| t.strip_suffix(')')) else {
        return tag;
    };
    match inner.rsplit_once(':') {
        Some((name, weight)) if !name.is_empty() && is_weight_number(weight) => name,
        _ => tag,
    }
}

pub fn normalize(tag: &str) -> String {
    let unescaped = strip_weight(tag.trim())
        .replace("\\(", "(")
        .replace("\\)", ")");
    unescaped
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
}

pub fn match_rank(name: &str, query: &str, tokens: &[&str]) -> i8 {
    match name.find(query) {
        Some(0) => 0,
        Some(i) if b"_(-/:".contains(&name.as_bytes()[i - 1]) => 0,
        Some(_) => 1,
        None if tokens.len() > 1 && tokens.iter().all(|t| name.contains(t)) => 1,
        None => -1,
    }
}

fn match_with_aliases<'a>(
    name: &str,
    aliases: &'a [String],
    query: &str,
    tokens: &[&str],
) -> (i8, Option<&'a String>) {
    let rank = match_rank(name, query, tokens);
    if rank < 0 {
        if let Some(alias) = aliases.iter().find(|a| a.starts_with(query)) {
            return (0, Some(alias));
        }
    }
    (rank, None)
}

fn unique<T: Copy + Eq + std::hash::Hash>(items: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut seen = HashSet::new();
    items.into_iter().filter(|i| seen.insert(*i)).collect()
}

pub struct TagDb {
    built: Option<String>,
    fields: Vec<Field>,
    field_index: HashMap<String, usize>,
    tags: Vec<Tag>,
    tag_id: HashMap<String, usize>,
    by_field: Vec<Vec<usize>>,
    aliases: HashMap<usize, Vec<String>>,
    implies: HashMap<usize, Vec<usize>>,
    soft: HashSet<usize>,
    colors: Vec<String>,
    groups: HashMap<String, Group>,
    group_of: HashMap<usize, String>,
    series: Vec<(String, u64)>,
    characters: Vec<Character>,
    char_id: HashMap<String, usize>,
    stats: CharacterStats,
    posts: Mutex<Option<PostArrays>>,
    pool: OnceLock<Pool>,
    char_weights: OnceLock<Vec<f64>>,
}

impl TagDb {
    pub fn from_parts(
        meta: Meta,
        characters: Vec<CharacterRow>,
        stats: CharacterStats,
        posts: PostArrays,
    ) -> Self {
        let field_index = meta
            .fields
            .iter()
            .enumerate()
            .map(|(i, f)| (f.id.clone(), i))
            .collect();
        let tags: Vec<Tag> = meta
            .tags
            .into_iter()
            .map(|(name, field, count, nsfw)| Tag {
                name,
                field,
                count,
                nsfw,
            })
            .collect();
        let tag_id = tags
            .iter()
            .enumerate()
            .map(|(i, t)| (t.name.clone(), i))
            .collect();
        let mut by_field = vec![Vec::new(); meta.fields.len()];
        for (i, t) in tags.iter().enumerate() {
            by_field[t.field].push(i);
        }
        let parse_key = |k: String| k.parse::<usize>().ok();
        let aliases = meta
            .aliases
            .into_iter()
            .filter_map(|(k, v)| Some((parse_key(k)?, v)))
            .collect();
        let implies = meta
            .implies
            .into_iter()
            .filter_map(|(k, mut v)| {
                v.sort_unstable();
                Some((parse_key(k)?, v))
            })
            .collect();
        let groups: HashMap<String, Group> = meta
            .groups
            .into_iter()
            .map(|(name, g)| {
                let group = Group {
                    tags: g.tags.into_iter().collect(),
                    multi: g.multi.into_iter().collect(),
                };
                (name, group)
            })
            .collect();
        let group_of = groups
            .iter()
            .flat_map(|(name, g)| g.tags.iter().map(move |&t| (t, name.clone())))
            .collect();
        let characters: Vec<Character> = characters
            .into_iter()
            .map(|(name, count, series, aliases, clean)| Character {
                name,
                count,
                series,
                aliases,
                clean: clean == 1,
            })
            .collect();
        let char_id = characters
            .iter()
            .enumerate()
            .map(|(i, c)| (c.name.clone(), i))
            .collect();

        Self {
            built: meta.built,
            fields: meta.fields,
            field_index,
            tags,
            tag_id,
            by_field,
            aliases,
            implies,
            soft: meta.soft.into_iter().collect(),
            colors: meta.colors.into_iter().map(|c| c + "_").collect(),
            groups,
            group_of,
            series: meta.series,
            characters,
            char_id,
            stats,
            posts: Mutex::new(Some(posts)),
            pool: OnceLock::new(),
            char_weights: OnceLock::new(),
        }
    }

    pub fn fields(&self) -> &[Field] {
        &self.fields
    }

    pub fn built(&self) -> Option<&str> {
        self.built.as_deref()
    }

    fn pool(&self) -> &Pool {
        self.pool.get_or_init(|| {
            let tag_field: Vec<usize> = self.tags.iter().map(|t| t.field).collect();
            let posts = self
                .posts
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take()
                .unwrap_or_default();
            Pool::build(posts, self.tags.len(), &tag_field, self.fields.len())
        })
    }

    // Helpers
    fn field_id(&self, index: usize) -> &str {
        &self.fields[index].id
    }

    fn tag_field_id(&self, tag: usize) -> &str {
        self.field_id(self.tags[tag].field)
    }

    fn implied_by(&self, tag: usize) -> &[usize] {
        self.implies.get(&tag).map_or(&[], Vec::as_slice)
    }

    fn implies_tag(&self, tag: usize, other: usize) -> bool {
        self.implied_by(tag).contains(&other)
    }

    fn in_group(&self, tag: usize, group: &str) -> bool {
        self.group_of.get(&tag).is_some_and(|g| g == group)
    }

    fn ids(&self, tags: &[String]) -> Vec<usize> {
        tags.iter()
            .filter_map(|t| self.tag_id.get(&normalize(t)).copied())
            .collect()
    }

    fn context_ids(&self, context: &Context, skip: &[&str]) -> Vec<usize> {
        unique(
            context
                .iter()
                .filter(|(field, _)| !skip.contains(&field.as_str()))
                .flat_map(|(_, tags)| self.ids(tags)),
        )
    }

    fn find_character(&self, tags: Option<&Vec<String>>) -> Option<usize> {
        tags?
            .iter()
            .find_map(|t| self.char_id.get(&normalize(t)).copied())
    }

    fn char_pairs(&self, ci: usize) -> impl Iterator<Item = (usize, u8)> + '_ {
        let (a, b) = (
            self.stats.indptr[ci] as usize,
            self.stats.indptr[ci + 1] as usize,
        );
        self.stats.tags[a..b]
            .iter()
            .zip(&self.stats.percent[a..b])
            .map(|(&t, &p)| (t as usize, p))
    }

    fn char_field_tags(&self, ci: usize) -> HashMap<usize, Vec<(usize, u8)>> {
        let mut out: HashMap<usize, Vec<(usize, u8)>> = HashMap::new();
        for (tag, pct) in self.char_pairs(ci) {
            out.entry(self.tags[tag].field)
                .or_default()
                .push((tag, pct));
        }
        out
    }

    fn is_person(&self, ci: usize) -> bool {
        self.char_pairs(ci)
            .any(|(t, p)| p >= 60 && self.in_group(t, "subject"))
    }

    fn character_tags(c: &Character) -> Vec<String> {
        if c.series.is_empty() {
            vec![c.name.clone()]
        } else {
            vec![c.name.clone(), c.series.clone()]
        }
    }

    fn subject_order(&self, tag: usize) -> u8 {
        if self.in_group(tag, "subject") {
            0
        } else if self.tags[tag].name == "solo" {
            1
        } else {
            2
        }
    }

    fn dedupe(&self, tags: Vec<usize>) -> Vec<usize> {
        let implied: HashSet<usize> = tags
            .iter()
            .flat_map(|&t| self.implied_by(t).iter().copied())
            .collect();
        tags.into_iter().filter(|t| !implied.contains(t)).collect()
    }

    fn suggestion(&self, tag: usize, hint: Option<String>) -> Suggestion {
        let t = &self.tags[tag];
        Suggestion {
            tag: t.name.clone(),
            count: t.count,
            kind: "tag",
            field: Some(self.field_id(t.field).to_string()),
            series: None,
            alias: None,
            hint,
        }
    }

    fn character_suggestion(&self, ci: usize, alias: Option<&String>) -> Suggestion {
        let c = &self.characters[ci];
        Suggestion {
            tag: c.name.clone(),
            count: c.count,
            kind: CHARACTER,
            field: None,
            series: Some(c.series.clone()),
            alias: alias.cloned(),
            hint: None,
        }
    }

    // Autocomplete
    pub fn autocomplete(&self, field: &str, query: &str, limit: usize) -> Vec<Suggestion> {
        let q = normalize(query);
        if q.is_empty() {
            return Vec::new();
        }
        let tokens: Vec<&str> = q.split('_').filter(|t| !t.is_empty()).collect();
        if field == CHARACTER {
            return self.autocomplete_character(&q, &tokens, limit);
        }
        let fi = self.field_index.get(field).copied();
        let mut found: Vec<_> = self
            .tags
            .iter()
            .enumerate()
            .filter_map(|(i, t)| {
                let aliases = self.aliases.get(&i).map_or(&[][..], Vec::as_slice);
                let (rank, alias) = match_with_aliases(&t.name, aliases, &q, &tokens);
                (rank >= 0).then_some(((Some(t.field) != fi, rank, Reverse(t.count), i), alias))
            })
            .collect();
        found.sort_by(|a, b| a.0.cmp(&b.0));
        found
            .into_iter()
            .take(limit)
            .map(|((.., i), alias)| Suggestion {
                alias: alias.cloned(),
                ..self.suggestion(i, None)
            })
            .collect()
    }

    fn autocomplete_character(&self, q: &str, tokens: &[&str], limit: usize) -> Vec<Suggestion> {
        let mut found: Vec<_> = self
            .characters
            .iter()
            .enumerate()
            .filter_map(|(i, c)| {
                let (rank, alias) = match_with_aliases(&c.name, &c.aliases, q, tokens);
                (rank >= 0).then_some(((rank, Reverse(c.count), i), alias))
            })
            .collect();
        found.sort_by(|a, b| a.0.cmp(&b.0));
        let mut out: Vec<Suggestion> = found
            .into_iter()
            .take(limit)
            .map(|((.., i), alias)| self.character_suggestion(i, alias))
            .collect();
        if out.len() < limit {
            let mut series: Vec<_> = self
                .series
                .iter()
                .filter_map(|(s, n)| {
                    let rank = match_rank(s, q, tokens);
                    (rank >= 0).then_some((rank, Reverse(*n), s))
                })
                .collect();
            series.sort();
            let room = limit - out.len();
            out.extend(
                series
                    .into_iter()
                    .take(room)
                    .map(|(_, Reverse(n), s)| Suggestion {
                        tag: s.clone(),
                        count: n,
                        kind: "series",
                        field: None,
                        series: None,
                        alias: None,
                        hint: None,
                    }),
            );
        }
        out
    }

    pub fn suggest(
        &self,
        field: &str,
        context: &Context,
        limit: usize,
        rating: &str,
    ) -> Result<Vec<Suggestion>, String> {
        if field == CHARACTER {
            return Ok((0..limit.min(self.characters.len()))
                .map(|ci| self.character_suggestion(ci, None))
                .collect());
        }
        let Some(&fi) = self.field_index.get(field) else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        let mut seen: HashSet<usize> = self
            .ids(context.get(field).map_or(&[][..], Vec::as_slice))
            .into_iter()
            .collect();
        let mut add = |tag: usize, hint: Option<String>, out: &mut Vec<Suggestion>| {
            if out.len() < limit && seen.insert(tag) {
                out.push(self.suggestion(tag, hint));
            }
        };

        if let Some(ci) = self.find_character(context.get(CHARACTER)) {
            for (tag, pct) in self.char_field_tags(ci).remove(&fi).unwrap_or_default() {
                add(tag, Some(format!("{pct}%")), &mut out);
            }
        }

        let ctx = self.context_ids(context, &[field, CHARACTER]);
        if !ctx.is_empty() && out.len() < limit {
            let pool = self.pool();
            let (scores, usable) = self.score_posts(pool, &ctx, Some(fi), rating, 1, &[]);
            if usable.iter().any(|&u| u) {
                let mut counts = vec![0u32; self.tags.len()];
                for p in Self::top_posts(&scores, &usable, 300) {
                    for &t in pool.post_tags(p) {
                        counts[t as usize] += 1;
                    }
                }
                let mut ranked: Vec<usize> = (0..self.tags.len())
                    .filter(|&t| self.tags[t].field == fi && counts[t] > 0)
                    .collect();
                ranked.sort_by_key(|&t| (Reverse(counts[t]), t));
                for t in ranked.into_iter().take(limit * 2) {
                    if counts[t] < 3 {
                        break;
                    }
                    add(t, None, &mut out);
                }
            }
        }

        for &tag in &self.by_field[fi] {
            if out.len() >= limit {
                break;
            }
            add(tag, None, &mut out);
        }
        Ok(out)
    }

    // Character preset
    fn is_colour_variant(&self, tag: usize, parent: usize) -> bool {
        let (name, pname) = (&self.tags[tag].name, &self.tags[parent].name);
        name.len() > pname.len()
            && name.ends_with(&format!("_{pname}"))
            && self
                .colors
                .iter()
                .any(|c| *c == name[..name.len() - pname.len()])
    }

    fn select(&self, field: &str, items: &[(usize, u8)], min_percent: Option<u8>) -> Vec<usize> {
        let Some(&(_, rule_min, rel, max_tags)) = PRESET_RULES.iter().find(|r| r.0 == field) else {
            return Vec::new();
        };
        let min_pct = min_percent.map_or(rule_min, |m| rule_min.min(m));
        let pct: HashMap<usize, f64> = items
            .iter()
            .filter(|(t, _)| !self.soft.contains(t))
            .map(|&(t, p)| (t, p as f64))
            .collect();
        let mut cand: Vec<usize> = unique(
            items
                .iter()
                .filter(|(t, p)| !self.soft.contains(t) && *p >= min_pct)
                .map(|&(t, _)| t),
        );

        let mut by_group: Vec<(&String, Vec<usize>)> = Vec::new();
        for &t in &cand {
            if let Some(g) = self.group_of.get(&t) {
                match by_group.iter_mut().find(|(name, _)| *name == g) {
                    Some((_, members)) => members.push(t),
                    None => by_group.push((g, vec![t])),
                }
            }
        }
        let cand_set: HashSet<usize> = cand.iter().copied().collect();
        let mut drop: HashSet<usize> = HashSet::new();
        for (g, mut members) in by_group {
            members.sort_by(|a, b| pct[b].total_cmp(&pct[a]));
            let mut best = members[0];
            for &t in &members[1..] {
                if self.implies_tag(t, best) && pct[&t] >= 0.5 * pct[&best] {
                    best = t;
                }
            }
            let mut keep = vec![best];
            if self.groups[g].multi.iter().any(|m| cand_set.contains(m)) {
                keep.extend(
                    members
                        .iter()
                        .copied()
                        .filter(|&t| {
                            t != best
                                && !self.implies_tag(t, best)
                                && !self.implies_tag(best, t)
                                && pct[&t] >= 0.4 * pct[&best]
                        })
                        .take(1),
                );
            }
            drop.extend(members.into_iter().filter(|t| !keep.contains(t)));
        }
        cand.retain(|t| !drop.contains(t));

        let mut drop: HashSet<usize> = HashSet::new();
        let mut variants_of: Vec<(usize, Vec<usize>)> = Vec::new();
        for &t in &cand {
            for &parent in self.implied_by(t) {
                if pct.contains_key(&parent) && pct[&t] < 0.2 * pct[&parent] {
                    drop.insert(t);
                } else if self.is_colour_variant(t, parent) {
                    match variants_of.iter_mut().find(|(p, _)| *p == parent) {
                        Some((_, variants)) => variants.push(t),
                        None => variants_of.push((parent, vec![t])),
                    }
                }
            }
        }
        for (_, variants) in variants_of {
            let mut variants: Vec<usize> =
                variants.into_iter().filter(|t| !drop.contains(t)).collect();
            variants.sort_by(|a, b| pct[b].total_cmp(&pct[a]));
            if let Some(&main) = variants.first() {
                let close = 0.75 * pct[&main];
                drop.extend(variants[1..].iter().copied().filter(|t| pct[t] < close));
            }
        }
        cand.retain(|t| !drop.contains(t));
        let mut cand = self.dedupe(cand);

        if let Some(top) = cand.iter().map(|t| pct[t]).reduce(f64::max) {
            cand.retain(|t| pct[t] >= rel * top);
        }
        cand.sort_by(|a, b| {
            (!self.in_group(*a, "subject"))
                .cmp(&!self.in_group(*b, "subject"))
                .then(pct[b].total_cmp(&pct[a]))
        });
        cand.truncate(max_tags);
        cand
    }

    pub fn character_preset(&self, name: &str) -> Option<Preset> {
        let ci = *self.char_id.get(&normalize(name))?;
        let c = &self.characters[ci];
        let mut per_field = self.char_field_tags(ci);
        let mut fields = HashMap::from([(CHARACTER.to_string(), Self::character_tags(c))]);
        for (fi, field) in self.fields.iter().enumerate() {
            if field.id == CHARACTER {
                continue;
            }
            let items = per_field.remove(&fi).unwrap_or_default();
            let mut picked = self.select(&field.id, &items, None);
            if picked.is_empty() {
                if let Some(&(_, fallback)) =
                    PRESET_FALLBACK_PERCENT.iter().find(|f| f.0 == field.id)
                {
                    picked = self.select(&field.id, &items, Some(fallback));
                }
            }
            if field.id == "subject" {
                if let Some(&solo) = self.tag_id.get("solo") {
                    if !picked.contains(&solo) {
                        picked.push(solo);
                    }
                }
                picked.sort_by_key(|&t| self.subject_order(t));
            }
            let names = picked
                .into_iter()
                .map(|t| self.tags[t].name.clone())
                .collect();
            fields.insert(field.id.clone(), names);
        }
        Some(Preset {
            character: c.name.clone(),
            series: c.series.clone(),
            count: c.count,
            fields,
        })
    }

    // Dice
    fn score_posts(
        &self,
        pool: &Pool,
        ctx: &[usize],
        field: Option<usize>,
        rating: &str,
        want: usize,
        require: &[usize],
    ) -> (Vec<f32>, Vec<bool>) {
        let n = pool.len();
        let mut scores = vec![0f32; n];
        for &t in ctx {
            for &p in pool.posts_with(t) {
                scores[p as usize] += pool.idf[t];
            }
        }
        let level = rating_level(rating);
        let mut usable: Vec<bool> = pool.rating.iter().map(|&r| r <= level).collect();
        if !require.is_empty() {
            let mut has = vec![0usize; n];
            for &t in require {
                for &p in pool.posts_with(t) {
                    has[p as usize] += 1;
                }
            }
            let has_all = |p: usize| has[p] == require.len();
            if (0..n).any(|p| usable[p] && has_all(p)) {
                for (p, u) in usable.iter_mut().enumerate() {
                    *u &= has_all(p);
                }
            }
        }
        if let Some(fi) = field {
            let have = &pool.field_count[fi];
            let full = (0..n)
                .filter(|&p| usable[p] && have[p] as usize >= want)
                .count();
            for (p, u) in usable.iter_mut().enumerate() {
                *u &= if full >= POOL_FULL_MIN {
                    have[p] as usize >= want
                } else {
                    have[p] > 0
                };
            }
        }
        (scores, usable)
    }

    fn top_posts(scores: &[f32], usable: &[bool], k: usize) -> Vec<usize> {
        let mut idx: Vec<usize> = (0..usable.len()).filter(|&p| usable[p]).collect();
        if idx.len() > k {
            idx.select_nth_unstable_by(k, |a, b| scores[*b].total_cmp(&scores[*a]));
            idx.truncate(k);
            idx.sort_unstable();
        }
        idx
    }

    fn draw_posts(
        &self,
        pool: &Pool,
        ctx: &[usize],
        field: Option<usize>,
        rating: &str,
        rng: &mut Rng,
        want: usize,
        k: usize,
        require: &[usize],
    ) -> Vec<usize> {
        let (scores, usable) = self.score_posts(pool, ctx, field, rating, want, require);
        if !usable.iter().any(|&u| u) {
            return Vec::new();
        }
        let order: Vec<usize> = if ctx.is_empty() {
            let idx: Vec<usize> = (0..usable.len()).filter(|&p| usable[p]).collect();
            (0..k).map(|_| idx[rng.below(idx.len())]).collect()
        } else {
            let top = Self::top_posts(&scores, &usable, 80);
            let max = top
                .iter()
                .map(|&p| scores[p] as f64)
                .fold(f64::MIN, f64::max);
            let temperature = (0.12 * max.max(1.0)).max(1e-6);
            let weights: Vec<f64> = top
                .iter()
                .map(|&p| ((scores[p] as f64 - max) / temperature).exp())
                .collect();
            (0..k).map(|_| top[rng.weighted(&weights)]).collect()
        };
        unique(order)
    }

    fn usable(&self, tag: usize, rating: &str) -> bool {
        let t = &self.tags[tag];
        t.count >= RANDOM_MIN_COUNT && (rating_level(rating) >= 2 || t.nsfw < 0.5)
    }

    fn conflicts(&self, tag: usize, picked: &[usize]) -> bool {
        if picked.contains(&tag) {
            return true;
        }
        let group = self.group_of.get(&tag);
        let exclusive =
            group.is_some_and(|g| !self.groups[g].multi.iter().any(|m| picked.contains(m)));
        picked.iter().any(|&t| {
            (exclusive && self.group_of.get(&t) == group)
                || self.implies_tag(t, tag)
                || self.implies_tag(tag, t)
        })
    }

    fn take(
        &self,
        pool: &Pool,
        post: usize,
        field: usize,
        count: usize,
        rating: &str,
        rng: &mut Rng,
        picked: Vec<usize>,
    ) -> Vec<usize> {
        let candidates: Vec<usize> = pool
            .post_tags(post)
            .iter()
            .map(|&t| t as usize)
            .filter(|&t| self.tags[t].field == field && self.usable(t, rating))
            .collect();
        let mut candidates = self.dedupe(candidates);
        rng.shuffle(&mut candidates);
        if self.field_id(field) == "subject" {
            candidates.sort_by_key(|&t| self.subject_order(t));
        }
        let mut out = picked;
        for t in candidates {
            if out.len() >= count {
                break;
            }
            if !self.conflicts(t, &out) {
                out.push(t);
            }
        }
        out
    }

    fn names(&self, mut ids: Vec<usize>, field: &str) -> Vec<String> {
        if field == "subject" {
            ids.sort_by_key(|&t| self.subject_order(t));
        } else {
            ids.sort_by_key(|&t| Reverse(self.tags[t].count));
        }
        ids.into_iter().map(|t| self.tags[t].name.clone()).collect()
    }

    fn random_character(&self, rng: &mut Rng, require: &[usize]) -> Result<Vec<String>, String> {
        let base = self.char_weights.get_or_init(|| {
            self.characters
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    if c.count >= 300 && c.clean && self.is_person(i) {
                        (c.count as f64).sqrt()
                    } else {
                        0.0
                    }
                })
                .collect()
        });
        let weights: Vec<f64> = base
            .iter()
            .enumerate()
            .map(|(ci, &w)| {
                let fits = w > 0.0
                    && require.iter().all(|&r| {
                        self.char_pairs(ci)
                            .any(|(t, p)| t == r && p >= REQUIRE_PERCENT)
                    });
                if fits {
                    w
                } else {
                    0.0
                }
            })
            .collect();
        if !weights.iter().any(|&w| w > 0.0) {
            return Err("No character has these tags".into());
        }
        Ok(Self::character_tags(
            &self.characters[rng.weighted(&weights)],
        ))
    }

    fn random_field(
        &self,
        field: &str,
        count: usize,
        context: &Context,
        rating: &str,
        rng: &mut Rng,
        require: &[usize],
    ) -> Result<Vec<String>, String> {
        if count == 0 {
            return Ok(Vec::new());
        }
        if field == CHARACTER {
            return self.random_character(rng, require);
        }
        let Some(&fi) = self.field_index.get(field) else {
            return Ok(Vec::new());
        };
        let pool = self.pool();
        let ctx = unique(
            self.context_ids(context, &[field, CHARACTER])
                .into_iter()
                .chain(require.iter().copied()),
        );
        let mut picked = Vec::new();
        for post in self.draw_posts(pool, &ctx, Some(fi), rating, rng, count, 30, require) {
            picked = self.take(pool, post, fi, count, rating, rng, picked);
            if picked.len() >= count {
                break;
            }
        }
        Ok(self.names(picked, field))
    }

    pub fn randomize(
        &self,
        fields: &[String],
        counts: &HashMap<String, i64>,
        context: &Context,
        rating: &str,
        seed: Option<u64>,
        require: &[String],
    ) -> Result<HashMap<String, Vec<String>>, String> {
        let req = self.ids(require);
        let mut rng = Rng::new(seed);
        let mut todo: Vec<&str> = self
            .fields
            .iter()
            .map(|f| f.id.as_str())
            .filter(|f| fields.iter().any(|x| x == f))
            .collect();
        let mut context: Context = context
            .iter()
            .filter(|(f, _)| !todo.contains(&f.as_str()))
            .map(|(f, t)| (f.clone(), t.clone()))
            .collect();
        let mut out = HashMap::new();
        let count_of = |field: &str| -> usize {
            let default = self
                .field_index
                .get(field)
                .map_or(0, |&i| self.fields[i].count);
            counts.get(field).copied().unwrap_or(default).max(0) as usize
        };
        let mut put = |field: &str, tags: Vec<String>, context: &mut Context| {
            context.insert(field.to_string(), tags.clone());
            out.insert(field.to_string(), tags);
        };

        if let &[only] = todo.as_slice() {
            let tags = self.random_field(only, count_of(only), &context, rating, &mut rng, &req)?;
            put(only, tags, &mut context);
            return Ok(self.with_required(out, &req));
        }

        if let Some(i) = todo.iter().position(|f| *f == CHARACTER) {
            todo.remove(i);
            let tags = if count_of(CHARACTER) > 0 {
                self.random_character(&mut rng, &req)?
            } else {
                Vec::new()
            };
            put(CHARACTER, tags, &mut context);
        }
        if let Some(ci) = self.find_character(context.get(CHARACTER)) {
            if let Some(mut preset) = self.character_preset(&self.characters[ci].name) {
                for f in IDENTITY_FIELDS {
                    if let Some(i) = todo.iter().position(|t| *t == f) {
                        todo.remove(i);
                        put(f, preset.fields.remove(f).unwrap_or_default(), &mut context);
                    }
                }
            }
        }
        if todo.is_empty() {
            return Ok(self.with_required(out, &req));
        }

        let pool = self.pool();
        let ctx = unique(
            self.context_ids(&context, &[CHARACTER])
                .into_iter()
                .chain(req.iter().copied()),
        );
        let anchor = self
            .draw_posts(pool, &ctx, None, rating, &mut rng, 1, 1, &req)
            .first()
            .copied();
        let dressed = anchor.is_some_and(|a| {
            GARMENT_FIELDS
                .iter()
                .filter_map(|g| self.field_index.get(*g))
                .map(|&gi| pool.field_count[gi][a] as usize)
                .sum::<usize>()
                >= 2
        });
        for f in todo {
            let n = count_of(f);
            let fi = self.field_index[f];
            let picked = match anchor {
                Some(a) if n > 0 => self.take(pool, a, fi, n, rating, &mut rng, Vec::new()),
                _ => Vec::new(),
            };
            let tags = if !picked.is_empty() || n == 0 || (dressed && GARMENT_FIELDS.contains(&f)) {
                self.names(picked, f)
            } else {
                self.random_field(f, n, &context, rating, &mut rng, &req)?
            };
            put(f, tags, &mut context);
        }
        Ok(self.with_required(out, &req))
    }

    fn with_required(
        &self,
        mut out: HashMap<String, Vec<String>>,
        req: &[usize],
    ) -> HashMap<String, Vec<String>> {
        for &r in req {
            let field = self.tag_field_id(r);
            if field == CHARACTER {
                continue;
            }
            let Some(current) = out.get(field) else {
                continue;
            };
            let have = self.ids(current);
            if have.contains(&r) || have.iter().any(|&t| self.implies_tag(t, r)) {
                continue;
            }
            let kept: Vec<usize> = have
                .into_iter()
                .filter(|&t| !self.conflicts(r, &[t]))
                .chain([r])
                .collect();
            out.insert(field.to_string(), self.names(kept, field));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(id: &str, group: &str, count: i64) -> Field {
        Field {
            id: id.into(),
            label: id.into(),
            count,
            group: group.into(),
        }
    }

    fn mini_db() -> TagDb {
        let meta = Meta {
            built: None,
            fields: vec![
                field("character", "who", 1),
                field("subject", "who", 2),
                field("hair", "looks", 2),
                field("top", "clothes", 2),
            ],
            tags: vec![
                ("1girl".into(), 1, 9000, 0.1),
                ("solo".into(), 1, 8000, 0.1),
                ("blue_hair".into(), 2, 5000, 0.1),
                ("aqua_hair".into(), 2, 4000, 0.1),
                ("long_hair".into(), 2, 6000, 0.1),
                ("shirt".into(), 3, 7000, 0.1),
                ("white_shirt".into(), 3, 3000, 0.1),
                ("sailor_collar".into(), 3, 2000, 0.1),
            ],
            implies: HashMap::from([("6".into(), vec![5])]),
            groups: HashMap::from([
                (
                    "subject".into(),
                    GroupRow {
                        tags: vec![0],
                        multi: vec![],
                    },
                ),
                (
                    "hair_color".into(),
                    GroupRow {
                        tags: vec![2, 3],
                        multi: vec![],
                    },
                ),
            ]),
            soft: vec![],
            colors: vec!["white".into(), "blue".into()],
            aliases: HashMap::from([("2".into(), vec!["azure_hair".into()])]),
            series: vec![("vocaloid".into(), 500)],
        };
        let characters = vec![
            (
                "hatsune_miku".into(),
                1000,
                "vocaloid".into(),
                vec!["/hm".into()],
                1,
            ),
            ("mikuru".into(), 400, "".into(), vec![], 1),
        ];
        let stats = CharacterStats {
            indptr: vec![0, 6, 8],
            tags: vec![0, 3, 2, 4, 6, 5, 0, 7],
            percent: vec![95, 80, 40, 70, 50, 60, 90, 60],
        };
        let posts = PostArrays {
            indptr: vec![0, 4, 8, 11],
            tags: vec![0, 1, 2, 7, 0, 1, 3, 6, 0, 4, 5],
            rating: vec![0, 0, 3],
        };
        TagDb::from_parts(meta, characters, stats, posts)
    }

    fn context(pairs: &[(&str, &[&str])]) -> Context {
        pairs
            .iter()
            .map(|(f, tags)| (f.to_string(), tags.iter().map(|t| t.to_string()).collect()))
            .collect()
    }

    #[test]
    fn normalize_strips_weight_escapes_and_spaces() {
        assert_eq!(normalize("  (Blue Hair:1.2) "), "blue_hair");
        assert_eq!(
            normalize("ganyu \\(genshin impact\\)"),
            "ganyu_(genshin_impact)"
        );
        assert_eq!(normalize("(note:1.)"), "(note:1.)");
    }

    #[test]
    fn word_start_match_ranks_before_substring() {
        assert_eq!(match_rank("hatsune_miku", "miku", &["miku"]), 0);
        assert_eq!(match_rank("kamiku", "miku", &["miku"]), 1);
        assert_eq!(
            match_rank("blue_long_hair", "hair_blue", &["hair", "blue"]),
            1
        );
        assert_eq!(match_rank("shirt", "skirt", &["skirt"]), -1);
    }

    #[test]
    fn autocomplete_prefers_edited_field_then_popularity() {
        let db = mini_db();
        let tags: Vec<String> = db
            .autocomplete("hair", "hair", 3)
            .into_iter()
            .map(|s| s.tag)
            .collect();
        assert_eq!(tags, ["long_hair", "blue_hair", "aqua_hair"]);
    }

    #[test]
    fn autocomplete_matches_aliases_and_series() {
        let db = mini_db();
        let alias = db.autocomplete("hair", "azure", 5);
        assert_eq!(alias[0].tag, "blue_hair");
        assert_eq!(alias[0].alias.as_deref(), Some("azure_hair"));
        let chars: Vec<String> = db
            .autocomplete("character", "voca", 5)
            .into_iter()
            .map(|s| s.kind.to_string() + ":" + &s.tag)
            .collect();
        assert_eq!(chars, ["series:vocaloid"]);
    }

    #[test]
    fn preset_keeps_one_tag_per_exclusive_group_and_drops_implied() {
        let preset = mini_db().character_preset("Hatsune Miku").unwrap();
        assert_eq!(preset.fields["character"], ["hatsune_miku", "vocaloid"]);
        assert_eq!(preset.fields["subject"], ["1girl", "solo"]);
        assert_eq!(preset.fields["hair"], ["aqua_hair", "long_hair"]);
        assert_eq!(preset.fields["top"], ["white_shirt"]);
    }

    #[test]
    fn preset_is_none_for_unknown_character() {
        assert!(mini_db().character_preset("nobody").is_none());
    }

    #[test]
    fn suggest_lists_character_tags_with_percent_first() {
        let db = mini_db();
        let found = db
            .suggest(
                "hair",
                &context(&[("character", &["hatsune_miku"])]),
                4,
                "general",
            )
            .unwrap();
        assert_eq!(found[0].tag, "aqua_hair");
        assert_eq!(found[0].hint.as_deref(), Some("80%"));
    }

    #[test]
    fn seeded_randomize_is_deterministic() {
        let db = mini_db();
        let fields = vec!["hair".to_string(), "top".to_string()];
        let roll = |seed| {
            db.randomize(
                &fields,
                &HashMap::new(),
                &Context::new(),
                "general",
                Some(seed),
                &[],
            )
            .unwrap()
        };
        assert_eq!(roll(7), roll(7));
    }

    #[test]
    fn randomize_takes_identity_from_character_and_skips_explicit_posts() {
        let db = mini_db();
        let fields = vec!["hair".to_string(), "top".to_string()];
        let ctx = context(&[("character", &["hatsune_miku", "vocaloid"])]);
        for seed in 0..20 {
            let out = db
                .randomize(&fields, &HashMap::new(), &ctx, "general", Some(seed), &[])
                .unwrap();
            assert_eq!(out["hair"], ["aqua_hair", "long_hair"]);
            assert!(!out["top"].contains(&"shirt".to_string()));
        }
    }

    #[test]
    fn randomize_keeps_required_tag() {
        let db = mini_db();
        let fields = vec!["top".to_string()];
        let required = vec!["sailor_collar".to_string()];
        for seed in 0..10 {
            let out = db
                .randomize(
                    &fields,
                    &HashMap::new(),
                    &Context::new(),
                    "explicit",
                    Some(seed),
                    &required,
                )
                .unwrap();
            assert!(out["top"].contains(&"sailor_collar".to_string()));
        }
    }

    #[test]
    fn random_character_fails_when_no_character_fits() {
        let db = mini_db();
        let fields = vec!["character".to_string()];
        let required = vec!["solo".to_string()];
        let err = db.randomize(
            &fields,
            &HashMap::new(),
            &Context::new(),
            "general",
            Some(1),
            &required,
        );
        assert_eq!(err.unwrap_err(), "No character has these tags");
    }
}
