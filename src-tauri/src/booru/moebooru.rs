use super::gelbooru::first_string;
use super::*;

// Engine for Moebooru sites (yande.re, konachan); each site is a
// `sources/*.rs` static
pub struct Moebooru {
    pub(crate) source: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) base: &'static str,
    pub(crate) media_hosts: &'static [&'static str],
    pub(crate) ratings: &'static [&'static str],
    pub(crate) cookie_auth: bool,
}

fn posts(raw: &Value) -> Result<&Vec<Value>, String> {
    raw.get("posts")
        .and_then(Value::as_array)
        .ok_or_else(|| "Invalid Moebooru posts response".into())
}

impl Moebooru {
    fn fetch(
        &self,
        client: &Client,
        tags: &str,
        page: usize,
        limit: usize,
        include_tags: bool,
        credentials: &HashMap<String, String>,
    ) -> Result<Value, String> {
        let mut request = client.get(format!("{}/post.json", self.base)).query(&[
            ("tags", tags.to_string()),
            ("page", page.to_string()),
            ("limit", limit.to_string()),
            ("api_version", "2".into()),
            ("include_tags", if include_tags { "1" } else { "0" }.into()),
        ]);
        if let Some(cookie) = credentials.get("cookie").filter(|c| !c.is_empty()) {
            request = request.header(reqwest::header::COOKIE, cookie.as_str());
        }
        if let Some(ua) = credentials.get("userAgent").filter(|u| !u.is_empty()) {
            request = request.header(reqwest::header::USER_AGENT, ua.as_str());
        }
        request = request.header(reqwest::header::REFERER, format!("{}/", self.base));
        request = request.header(
            reqwest::header::ACCEPT,
            "application/json, text/javascript, */*; q=0.01",
        );
        send_json(self.source, request)
    }

    fn summary(&self, post: &Value) -> PostSummary {
        let id = string(post.get("id"));
        let rating = string(post.get("rating"));
        PostSummary {
            source: self.source.into(),
            post_id: id.clone(),
            post_url: format!("{}/post/show/{id}", self.base),
            preview_url: first_string(post, &["sample_url", "preview_url", "jpeg_url", "file_url"]),
            sample_url: first_string(post, &["sample_url", "jpeg_url", "file_url", "preview_url"]),
            width: as_u64(post.get("width")),
            height: as_u64(post.get("height")),
            rating: match rating.as_str() {
                "s" => "safe".into(),
                "q" => "questionable".into(),
                "e" => "explicit".into(),
                _ => rating,
            },
            created_at: string(post.get("created_at")),
            score: as_i64(post.get("score")),
            ..PostSummary::default()
        }
    }

    fn query(&self, request: &SearchRequest) -> String {
        let mut tags = vec![request.query.trim().to_string()];
        let ratings = if self.ratings.is_empty() {
            Vec::new()
        } else if self.ratings.len() == 1 {
            vec!["safe".to_string()]
        } else {
            request.ratings.clone()
        };
        if !ratings.is_empty() {
            for rating in ["safe", "questionable", "explicit"] {
                if !ratings.iter().any(|value| value == rating) {
                    tags.push(format!("-rating:{rating}"));
                }
            }
        }
        match request.sort.as_str() {
            "score" => tags.push("order:score".into()),
            "random" => tags.push("order:random".into()),
            _ => {}
        }
        tags.join(" ").trim().into()
    }

    fn map_page(
        &self,
        raw: &Value,
        request: &SearchRequest,
        blacklist: &HashSet<String>,
        page: usize,
        limit: usize,
    ) -> Result<Page, String> {
        let raw = posts(raw)?;
        let mut warnings = Vec::new();
        let posts = raw
            .iter()
            .filter(|post| post.get("id").is_some() && is_static_post(post))
            .filter(|post| {
                if is_blacklisted(post, blacklist) {
                    if warnings.is_empty() {
                        warnings.push("local-blacklist-filtered".into());
                    }
                    false
                } else {
                    true
                }
            })
            .map(|post| self.summary(post))
            .filter(|post| {
                (self.ratings.is_empty()
                    || rating_matches(self.source, &post.rating, &request.ratings))
                    && (self.ratings.len() != 1 || post.rating == "safe")
            })
            .collect();
        Ok(Page {
            posts,
            next_cursor: (raw.len() == limit).then(|| (page + 1).to_string()),
            ended: raw.len() < limit,
            warnings,
            page,
            total: None,
        })
    }

    fn map_detail(&self, raw: &Value, post_id: &str) -> Result<PostDetail, String> {
        let post = posts(raw)?
            .iter()
            .find(|post| string(post.get("id")) == post_id)
            .ok_or_else(|| format!("{} post {post_id} was not found", self.source))?;
        let mut detail = PostDetail::from_summary(self.summary(post));
        detail.media_url = first_string(post, &["file_url", "jpeg_url", "sample_url"]);
        detail.file_ext = string(post.get("file_ext"));
        detail.file_size = as_u64(post.get("file_size"));
        detail.tags = group_as_general(&[]);
        let categories = raw
            .get("tags")
            .and_then(Value::as_object)
            .ok_or("Moebooru response is missing tag categories")?;
        for tag in split_tags(post.get("tags")) {
            let category = categories
                .get(&tag)
                .and_then(Value::as_str)
                .filter(|category| CATEGORY_ORDER.contains(category))
                .unwrap_or("general");
            detail.tags.entry(category.into()).or_default().push(tag);
        }
        detail.complete = true;
        Ok(detail)
    }
}

impl Provider for Moebooru {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            source: self.source,
            display_name: self.display_name,
            ratings: self.ratings,
            sort_values: &["latest", "score"],
            pagination: "page",
            max_page_size: 100,
            auth_fields: if self.cookie_auth {
                &["cookie", "userAgent"]
            } else {
                &[]
            },
            categorized_tags: true,
            favorite_read: false,
            favorite_write: false,
            ranking_periods: &[],
            page_jump: true,
            detail_hydration: true,
            download: true,
            auth_required: false,
            tag_search: true,
            max_search_tags: None,
            credentials_url: if self.cookie_auth { self.base } else { "" },
        }
    }

    fn media_hosts(&self) -> &'static [&'static str] {
        self.media_hosts
    }

    fn media_referer(&self) -> Option<&'static str> {
        Some(self.base)
    }

    fn search(
        &self,
        client: &Client,
        request: &SearchRequest,
        credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        let page = request
            .cursor
            .as_deref()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(1)
            .max(1);
        let limit = request.limit.clamp(1, 100);
        let raw = self.fetch(
            client,
            &self.query(request),
            page,
            limit,
            false,
            credentials,
        )?;
        self.map_page(&raw, request, blacklist, page, limit)
    }

    fn detail(
        &self,
        client: &Client,
        post_id: &str,
        credentials: &HashMap<String, String>,
    ) -> Result<PostDetail, String> {
        let id = post_id
            .parse::<u64>()
            .map_err(|_| "Invalid Moebooru post ID")?;
        let raw = self.fetch(client, &format!("id:{id}"), 1, 1, true, credentials)?;
        self.map_detail(&raw, &id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::super::sources::{KONACHAN_COM, KONACHAN_NET, YANDERE};
    use super::*;

    #[test]
    fn maps_moebooru_providers_and_filters() {
        let raw = serde_json::json!({"posts": [
            {"id": 42, "rating": "s", "tags": "artist_name scenery", "file_url": "https://files.yande.re/image/a.jpg", "sample_url": "https://files.yande.re/sample/a.jpg", "file_ext": "jpg"},
            {"id": 43, "rating": "e", "tags": "blocked", "file_url": "https://files.yande.re/image/b.png"}
        ], "tags": {"artist_name": "artist", "scenery": "general"}});
        for source in [&YANDERE, &KONACHAN_NET, &KONACHAN_COM] {
            assert!(provider(source.source).is_ok());
            let request = SearchRequest {
                ratings: vec!["safe".into()],
                sort: "score".into(),
                ..SearchRequest::default()
            };
            assert_eq!(
                source.query(&request),
                if source.ratings.is_empty() {
                    "order:score"
                } else {
                    "-rating:questionable -rating:explicit order:score"
                }
            );
            let page = source
                .map_page(&raw, &request, &HashSet::from(["blocked".into()]), 2, 2)
                .unwrap();
            assert_eq!(page.posts.len(), 1);
            assert_eq!(page.posts[0].rating, "safe");
            assert_eq!(page.next_cursor.as_deref(), Some("3"));
            assert!(!page.ended);
            assert_eq!(page.warnings, ["local-blacklist-filtered"]);
            let detail = source.map_detail(&raw, "42").unwrap();
            assert_eq!(detail.tags["artist"], ["artist_name"]);
            assert_eq!(detail.preview_url, "https://files.yande.re/sample/a.jpg");
            assert!(detail.complete);
            assert!(source.map_detail(&raw, "99").is_err());
            assert!(source
                .validate_media_url("https://example.com/a.jpg")
                .is_err());
            assert!(source
                .validate_media_url(&format!("{}/a.jpg", source.base))
                .is_ok());
            assert!(source
                .validate_media_url(&format!("{}/a.jpg", source.base.replace("https:", "http:")))
                .is_err());
        }
        assert!(posts(&serde_json::json!({"success": false})).is_err());
        assert!(YANDERE
            .validate_media_url("https://assets.yande.re/a.jpg")
            .is_ok());
        assert!(YANDERE
            .validate_media_url("https://files.yande.re.evil.com/a.jpg")
            .is_err());
    }

    #[test]
    fn yandere_ignores_saved_ratings_and_returns_all_ratings() {
        let request = SearchRequest {
            ratings: vec!["safe".into()],
            query: "scenery".into(),
            ..SearchRequest::default()
        };
        let raw = serde_json::json!({"posts": [
            {"id": 1, "rating": "s", "file_url": "https://files.yande.re/a.jpg"},
            {"id": 2, "rating": "q", "file_url": "https://files.yande.re/b.jpg"},
            {"id": 3, "rating": "e", "file_url": "https://files.yande.re/c.jpg"}
        ]});
        assert!(YANDERE.capabilities().ratings.is_empty());
        assert_eq!(YANDERE.query(&request), "scenery");
        let page = YANDERE
            .map_page(&raw, &request, &HashSet::new(), 1, 100)
            .unwrap();
        assert_eq!(
            page.posts
                .iter()
                .map(|post| post.rating.as_str())
                .collect::<Vec<_>>(),
            ["safe", "questionable", "explicit"]
        );
        assert_eq!(
            KONACHAN_COM
                .map_page(&raw, &request, &HashSet::new(), 1, 100)
                .unwrap()
                .posts
                .len(),
            1
        );
        assert_eq!(
            KONACHAN_COM.capabilities().auth_fields,
            ["cookie", "userAgent"]
        );
        assert_eq!(
            KONACHAN_NET.capabilities().auth_fields,
            Vec::<&str>::new().as_slice()
        );
    }
}
