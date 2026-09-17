use super::*;

pub struct Danbooru {
    source: &'static str,
    display_name: &'static str,
    base: &'static str,
    accounts: bool,
}

pub static DANBOORU: Danbooru = Danbooru {
    source: "danbooru",
    display_name: "Danbooru",
    base: "https://danbooru.donmai.us",
    accounts: true,
};
pub static AIBOORU: Danbooru = Danbooru {
    source: "aibooru",
    display_name: "AIBooru",
    base: "https://aibooru.online",
    accounts: false,
};

fn auth(credentials: &HashMap<String, String>) -> Vec<(String, String)> {
    match (credentials.get("username"), credentials.get("apiKey")) {
        (Some(username), Some(key)) if !username.is_empty() && !key.is_empty() => {
            vec![
                ("login".into(), username.clone()),
                ("api_key".into(), key.clone()),
            ]
        }
        _ => Vec::new(),
    }
}

fn summary(site: &Danbooru, post: &Value) -> PostSummary {
    let id = string(post.get("id"));
    PostSummary {
        source: site.source.into(),
        post_id: id.clone(),
        post_url: format!("{}/posts/{id}", site.base),
        preview_url: string(post.get("large_file_url"))
            .or_else_value(string(post.get("preview_file_url"))),
        sample_url: string(post.get("large_file_url")),
        width: as_u64(post.get("image_width")),
        height: as_u64(post.get("image_height")),
        rating: string(post.get("rating")),
        created_at: string(post.get("created_at")),
        favorite: post.get("is_favorited").and_then(Value::as_bool),
        score: as_i64(post.get("score")),
        fav_count: as_i64(post.get("fav_count")),
    }
}

trait NonEmpty {
    fn or_else_value(self, fallback: String) -> String;
}

impl NonEmpty for String {
    fn or_else_value(self, fallback: String) -> String {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}

fn page_from_raw(
    site: &Danbooru,
    raw: Value,
    page: usize,
    limit: usize,
    ratings: &[String],
    blacklist: &HashSet<String>,
) -> Result<Page, String> {
    let values = raw
        .as_array()
        .ok_or_else(|| format!("{} search response must be a list", site.source))?;
    let candidates: Vec<_> = values
        .iter()
        .filter(|post| post.get("id").is_some() && is_static_post(post))
        .collect();
    let visible: Vec<_> = candidates
        .iter()
        .copied()
        .filter(|post| !is_blacklisted(post, blacklist))
        .collect();
    let posts: Vec<_> = visible
        .iter()
        .map(|post| summary(site, post))
        .filter(|post| rating_matches(site.source, &post.rating, ratings))
        .collect();
    let mut warnings = if visible.len() < candidates.len() {
        vec!["local-blacklist-filtered".into()]
    } else {
        Vec::new()
    };
    if !posts.is_empty() && posts.iter().all(|post| post.preview_url.is_empty()) {
        warnings.push("restricted-media-hidden".into());
        return Ok(Page {
            posts: Vec::new(),
            next_cursor: None,
            ended: true,
            warnings,
            page,
            total: None,
        });
    }
    Ok(Page {
        posts,
        next_cursor: (values.len() == limit).then(|| (page + 1).to_string()),
        ended: values.len() < limit,
        warnings,
        page,
        total: None,
    })
}

fn search_tags(request: &SearchRequest, limit: usize) -> String {
    let mut tags = request.query.trim().to_string();
    if !request.ratings.is_empty() {
        tags = format!("{tags} rating:{}", request.ratings.join(","))
            .trim()
            .into();
    }
    if request.sort == "random" {
        tags = format!("{tags} random:{limit}").trim().into();
    } else if !request.sort.is_empty() && request.sort != "latest" {
        tags = format!("{tags} order:{}", request.sort).trim().into();
    }
    tags
}

fn categories(
    site: &Danbooru,
    client: &Client,
    tags: &[String],
    credentials: &HashMap<String, String>,
) -> Result<HashMap<String, Vec<String>>, String> {
    let mut result: HashMap<String, Vec<String>> = CATEGORY_ORDER
        .into_iter()
        .map(|key| (key.into(), Vec::new()))
        .collect();
    for chunk in tags.chunks(100) {
        let mut params = vec![
            ("search[name_comma]".into(), chunk.join(",")),
            ("limit".into(), "100".into()),
        ];
        params.extend(auth(credentials));
        let raw = send_json(
            site.source,
            client
                .get(format!("{}/tags.json", site.base))
                .query(&params),
        )?;
        let known: HashMap<String, String> = raw
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|tag| {
                let name = tag.get("name")?.as_str()?.to_string();
                let category = match as_i64(tag.get("category")) {
                    1 => "artist",
                    3 => "copyright",
                    4 => "character",
                    5 => "meta",
                    _ => "general",
                };
                Some((name, category.into()))
            })
            .collect();
        for tag in chunk {
            result
                .entry(known.get(tag).cloned().unwrap_or_else(|| "general".into()))
                .or_default()
                .push(tag.clone());
        }
    }
    Ok(result)
}

impl Provider for Danbooru {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            source: self.source,
            display_name: self.display_name,
            ratings: &["general", "sensitive", "questionable", "explicit"],
            sort_values: &["latest", "score", "favcount"],
            pagination: "page",
            max_page_size: 200,
            auth_fields: if self.accounts {
                &["username", "apiKey"]
            } else {
                &[]
            },
            categorized_tags: true,
            favorite_read: self.accounts,
            favorite_write: self.accounts,
            ranking_periods: &["day", "week", "month"],
            page_jump: true,
            detail_hydration: true,
            download: true,
            auth_required: false,
            tag_search: true,
            max_search_tags: Some(2),
            credentials_url: if self.accounts {
                "https://danbooru.donmai.us/settings"
            } else {
                ""
            },
        }
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
            .and_then(|v| v.parse().ok())
            .unwrap_or(1)
            .max(1);
        let limit = request.limit.clamp(1, 200);
        let tags = search_tags(request, limit);
        let mut params = vec![
            ("tags".into(), tags),
            ("page".into(), page.to_string()),
            ("limit".into(), limit.to_string()),
        ];
        params.extend(auth(credentials));
        page_from_raw(
            self,
            send_json(
                self.source,
                client
                    .get(format!("{}/posts.json", self.base))
                    .query(&params),
            )?,
            page,
            limit,
            &request.ratings,
            blacklist,
        )
    }

    fn ranking(
        &self,
        client: &Client,
        period: &str,
        request: &RankingRequest,
        credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        let page = request
            .cursor
            .as_deref()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1)
            .max(1);
        let limit = request.limit.clamp(1, 200);
        let mut params = vec![
            ("scale".into(), period.into()),
            ("page".into(), page.to_string()),
            ("limit".into(), limit.to_string()),
        ];
        params.extend(auth(credentials));
        page_from_raw(
            self,
            send_json(
                self.source,
                client
                    .get(format!("{}/explore/posts/popular.json", self.base))
                    .query(&params),
            )?,
            page,
            limit,
            &request.ratings,
            blacklist,
        )
    }

    fn detail(
        &self,
        client: &Client,
        post_id: &str,
        credentials: &HashMap<String, String>,
    ) -> Result<PostDetail, String> {
        let raw = send_json(
            self.source,
            client
                .get(format!("{}/posts/{post_id}.json", self.base))
                .query(&auth(credentials)),
        )?;
        let mut detail = PostDetail::from_summary(summary(self, &raw));
        detail.media_url = string(raw.get("file_url"));
        detail.sample_url =
            string(raw.get("large_file_url")).or_else_value(string(raw.get("preview_file_url")));
        detail.file_ext = string(raw.get("file_ext"));
        detail.file_size = as_u64(raw.get("file_size"));
        detail.tags = CATEGORY_ORDER
            .into_iter()
            .map(|category| {
                (
                    category.into(),
                    split_tags(raw.get(format!("tag_string_{category}"))),
                )
            })
            .collect();
        detail.complete = true;
        Ok(detail)
    }

    fn classify_tags(
        &self,
        client: &Client,
        tags: &[String],
        credentials: &HashMap<String, String>,
    ) -> Result<HashMap<String, Vec<String>>, String> {
        categories(self, client, tags, credentials)
    }

    fn known_tags(
        &self,
        client: &Client,
        names: &[String],
        credentials: &HashMap<String, String>,
    ) -> Result<HashSet<String>, String> {
        let mut result = HashSet::new();
        for chunk in names.chunks(100) {
            let mut params = vec![
                ("search[name_comma]".into(), chunk.join(",")),
                ("limit".into(), "100".into()),
            ];
            params.extend(auth(credentials));
            let raw = send_json(
                self.source,
                client
                    .get(format!("{}/tags.json", self.base))
                    .query(&params),
            )?;
            for tag in raw.as_array().into_iter().flatten() {
                if as_i64(tag.get("post_count")) > 0
                    && !tag
                        .get("is_deprecated")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                {
                    if let Some(name) = tag.get("name").and_then(Value::as_str) {
                        result.insert(name.to_lowercase());
                    }
                }
            }
        }
        Ok(result)
    }

    fn favorites(
        &self,
        client: &Client,
        request: &FavoritesRequest,
        credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        let username = credentials
            .get("username")
            .filter(|v| !v.is_empty())
            .ok_or_else(|| format!("{} username is required to read favorites", self.source))?;
        self.search(
            client,
            &SearchRequest {
                source: self.source.into(),
                query: format!("ordfav:{username}"),
                ratings: Vec::new(),
                sort: if request.random {
                    "random".into()
                } else {
                    "latest".into()
                },
                cursor: request.cursor.clone(),
                limit: request.limit,
                page: request.page,
                random: request.random,
            },
            credentials,
            blacklist,
        )
    }

    fn set_favorite(
        &self,
        client: &Client,
        post_id: &str,
        favorite: bool,
        credentials: &HashMap<String, String>,
    ) -> Result<bool, String> {
        let params = auth(credentials);
        if params.is_empty() {
            return Err(format!("{} username and API key are required", self.source));
        }
        let request = if favorite {
            client
                .post(format!("{}/favorites.json", self.base))
                .query(&params)
                .json(&serde_json::json!({"post_id": post_id}))
        } else {
            client
                .delete(format!("{}/favorites/{post_id}.json", self.base))
                .query(&params)
        };
        send_status(self.source, request)?;
        Ok(favorite)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_post_payload() {
        let post = serde_json::json!({"id": 12, "preview_file_url": "https://cdn.donmai.us/preview.jpg", "large_file_url": "https://cdn.donmai.us/large.jpg", "image_width": 800, "rating": "g"});
        let mapped = summary(&DANBOORU, &post);
        assert_eq!(mapped.post_id, "12");
        assert_eq!(mapped.post_url, "https://danbooru.donmai.us/posts/12");
        assert_eq!(mapped.preview_url, "https://cdn.donmai.us/large.jpg");
        assert_eq!(mapped.width, 800);
        assert_eq!(mapped.rating, "g");
        let aibooru = summary(&AIBOORU, &post);
        assert_eq!(aibooru.source, "aibooru");
        assert_eq!(aibooru.post_url, "https://aibooru.online/posts/12");
        assert!(AIBOORU.capabilities().auth_fields.is_empty());
        assert!(!AIBOORU.capabilities().favorite_write);
    }

    #[test]
    fn constructs_provider_search_tags() {
        let request = SearchRequest {
            query: "blue_hair".into(),
            ratings: vec!["general".into(), "sensitive".into()],
            sort: "score".into(),
            ..SearchRequest::default()
        };
        assert_eq!(
            search_tags(&request, 60),
            "blue_hair rating:general,sensitive order:score"
        );
    }
}
