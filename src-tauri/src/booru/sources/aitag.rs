use super::super::*;

pub struct AiTag;
pub static AI_TAG: AiTag = AiTag;
const BASE: &str = "https://aitag.win";
const ASSET_BASE: &str = "https://ai-img.10118899.xyz/";

/// aitag.win's Cloudflare WAF rejects API calls that lack a same-site referer.
fn api(client: &Client, path: &str) -> RequestBuilder {
    client
        .get(format!("{BASE}{path}"))
        .header(REFERER, AI_TAG.media_referer().unwrap_or_default())
}

fn decode_json(value: Option<&Value>) -> Value {
    match value {
        Some(Value::String(value)) => serde_json::from_str(value).unwrap_or(Value::Null),
        Some(value) => value.clone(),
        None => Value::Null,
    }
}

fn preview(work: &Value) -> String {
    let image_type = first(work, &["AI_type", "ai_type"]);
    let user_id = first(work, &["userId", "userid"]);
    let id = string(work.get("id"));
    if image_type.is_empty() || user_id.is_empty() || id.is_empty() {
        String::new()
    } else {
        format!("{ASSET_BASE}{image_type}/{user_id}/{id}_p0.webp")
    }
}

fn first(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .map(|key| string(value.get(*key)))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn summary(work: &Value) -> PostSummary {
    let id = string(work.get("id"));
    let preview = preview(work);
    PostSummary {
        source: "aitag".into(),
        post_id: id.clone(),
        post_url: format!("{BASE}/i/{id}"),
        preview_url: preview.clone(),
        sample_url: preview,
        width: 1,
        height: 1,
        rating: String::new(),
        created_at: string(work.get("create_date")),
        favorite: None,
        score: 0,
        fav_count: 0,
    }
}

fn tags_for_blacklist(work: &Value) -> HashSet<String> {
    let mut tags = raw_tags(work);
    if let Value::Array(values) = decode_json(work.get("tags")) {
        tags.extend(
            values
                .iter()
                .filter_map(Value::as_str)
                .map(|tag| tag.to_lowercase()),
        );
    }
    tags
}

fn page(
    raw: Value,
    current: usize,
    size: usize,
    blacklist: &HashSet<String>,
) -> Result<Page, String> {
    let items = raw
        .get("items")
        .and_then(Value::as_array)
        .ok_or("aitag response must contain an items list")?;
    let candidates: Vec<_> = items
        .iter()
        .filter(|item| !string(item.get("id")).is_empty())
        .collect();
    let visible: Vec<_> = candidates
        .iter()
        .copied()
        .filter(|item| tags_for_blacklist(item).is_disjoint(blacklist))
        .collect();
    let total = as_u64(raw.get("total")) as usize;
    let ended = items.len() < size || (total > 0 && current * size >= total);
    let mut warnings = vec!["AI TAG does not expose rating or categorized tag metadata.".into()];
    if visible.len() < candidates.len() {
        warnings.push("local-blacklist-filtered".into());
    }
    Ok(Page {
        posts: visible.into_iter().map(summary).collect(),
        next_cursor: (!ended).then(|| (current + 1).to_string()),
        ended,
        warnings,
        page: current,
        total: (total > 0).then_some(total),
    })
}

impl Provider for AiTag {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            source: "aitag",
            display_name: "AI TAG",
            ratings: &[],
            sort_values: &["new"],
            pagination: "page",
            max_page_size: 60,
            auth_fields: &[],
            categorized_tags: false,
            favorite_read: false,
            favorite_write: false,
            ranking_periods: &["month"],
            page_jump: true,
            detail_hydration: true,
            download: true,
            auth_required: false,
            tag_search: true,
            max_search_tags: None,
            credentials_url: "",
        }
    }

    fn normalize_query(
        &self,
        _client: &Client,
        query: &str,
        _credentials: &HashMap<String, String>,
    ) -> Result<String, String> {
        Ok(query.trim().into())
    }

    fn search(
        &self,
        client: &Client,
        request: &SearchRequest,
        _credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        if !request.ratings.is_empty() {
            return Err("aitag does not expose rating filters".into());
        }
        let current = request
            .cursor
            .as_deref()
            .and_then(|value| value.parse().ok())
            .unwrap_or(1)
            .max(1);
        let mut params = vec![("page", current.to_string()), ("page_size", "60".into())];
        if !request.query.trim().is_empty() {
            params.push(("q", request.query.trim().into()));
        }
        page(
            send_json("aitag", api(client, "/api/ai_works_search").query(&params))?,
            current,
            60,
            blacklist,
        )
    }

    fn ranking(
        &self,
        client: &Client,
        period: &str,
        request: &RankingRequest,
        _credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        if period != "month" {
            return Err(format!("aitag does not support {period} rankings"));
        }
        let current = request
            .cursor
            .as_deref()
            .and_then(|value| value.parse().ok())
            .unwrap_or(1)
            .max(1);
        page(
            send_json(
                "aitag",
                api(client, "/api/rank/monthly/real")
                    .query(&[("page", current), ("page_size", 60)]),
            )?,
            current,
            60,
            blacklist,
        )
    }

    fn detail(
        &self,
        client: &Client,
        post_id: &str,
        _credentials: &HashMap<String, String>,
    ) -> Result<PostDetail, String> {
        let mut raw = send_json("aitag", api(client, &format!("/api/work/{post_id}")))?;
        if raw.is_string() {
            raw = decode_json(Some(&raw));
        }
        let work = raw
            .get("work")
            .ok_or_else(|| format!("aitag post {post_id} response must contain a work object"))?;
        let mut images: Vec<_> = raw
            .get("images")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        images.sort_by_key(|image| {
            image
                .get("file_name")
                .and_then(Value::as_str)
                .and_then(image_index)
                .unwrap_or(usize::MAX)
        });
        let image = images.first().cloned().unwrap_or(Value::Null);
        let path = string(image.get("image_path"));
        let media = if path.is_empty() {
            preview(work)
        } else {
            format!("{ASSET_BASE}{}", path.trim_start_matches('/'))
        };
        let metadata = decode_json(work.get("json"));
        let prompt = string(image.get("prompt_text"));
        let prompt = prompt
            .split_once("\nSteps:")
            .map(|(head, _)| head)
            .unwrap_or(&prompt);
        let mut tags: Vec<String> = prompt
            .split([',', '\n'])
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        if tags.is_empty() {
            tags = decode_json(work.get("tags"))
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect();
        }
        let mut detail = PostDetail::from_summary(summary(work));
        detail.preview_url = media.clone();
        detail.sample_url = media.clone();
        detail.media_url = media;
        detail.width = as_u64(metadata.get("width")).max(1);
        detail.height = as_u64(metadata.get("height")).max(1);
        detail.file_ext = "webp".into();
        detail.tags = group_as_general(&tags);
        detail.complete = true;
        Ok(detail)
    }

    fn media_hosts(&self) -> &'static [&'static str] {
        &["ai-img.10118899.xyz"]
    }

    fn media_referer(&self) -> Option<&'static str> {
        Some("https://aitag.win/")
    }
}

fn image_index(name: &str) -> Option<usize> {
    name.rsplit_once("_p")?.1.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_ai_tag_preview_and_prompt_metadata() {
        let work = serde_json::json!({"id": 7, "AI_type": "sdxl", "userId": 4});
        assert_eq!(
            preview(&work),
            "https://ai-img.10118899.xyz/sdxl/4/7_p0.webp"
        );
        assert_eq!(image_index("7_p12"), Some(12));
        assert_eq!(AI_TAG.media_referer(), Some("https://aitag.win/"));
    }

    #[test]
    fn api_requests_carry_same_site_referer() {
        let request = api(&Client::new(), "/api/work/7").build().unwrap();
        assert_eq!(request.url().as_str(), "https://aitag.win/api/work/7");
        assert_eq!(
            request.headers().get(REFERER).unwrap(),
            "https://aitag.win/"
        );
    }
}
