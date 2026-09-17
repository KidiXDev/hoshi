use super::*;

// Engine for Gelbooru-API sites (gelbooru.com and the 0.2 clones); each site
// is a `sources/*.rs` static
pub struct Gelbooru {
    pub(crate) source: &'static str,
    pub(crate) display_name: &'static str,
    pub(crate) origin: &'static str,
    pub(crate) api_origin: &'static str,
    pub(crate) media_hosts: &'static [&'static str],
    pub(crate) ratings: &'static [&'static str],
    pub(crate) default_rating: &'static str,
    pub(crate) max_limit: usize,
    pub(crate) credentials_url: &'static str,
    pub(crate) api_key_required: bool,
    pub(crate) json_tag_lookup: bool,
    pub(crate) favorites: bool,
    pub(crate) media_referer: Option<&'static str>,
}

pub(crate) fn auth(credentials: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut user = credentials.get("userId").cloned().unwrap_or_default();
    let mut key = credentials.get("apiKey").cloned().unwrap_or_default();
    if key.contains('=') {
        if let Ok(url) = Url::parse(&format!(
            "https://localhost/?{}",
            key.trim_start_matches(['?', '&'])
        )) {
            let values: HashMap<String, String> = url.query_pairs().into_owned().collect();
            key = values.get("api_key").cloned().unwrap_or(key);
            if user.is_empty() {
                user = values.get("user_id").cloned().unwrap_or_default();
            }
        }
    }
    if user.is_empty() || key.is_empty() {
        Vec::new()
    } else {
        vec![("user_id".into(), user), ("api_key".into(), key)]
    }
}

pub(crate) fn normalize_credentials(credentials: &mut HashMap<String, String>) {
    let values: HashMap<_, _> = auth(credentials).into_iter().collect();
    if let Some(user) = values.get("user_id") {
        credentials.insert("userId".into(), user.clone());
    }
    if let Some(key) = values.get("api_key") {
        credentials.insert("apiKey".into(), key.clone());
    }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_i64().unwrap_or(0) != 0,
        Value::String(text) => matches!(text.as_str(), "1" | "true"),
        _ => false,
    }
}

fn attribute(tag: &str, name: &str) -> Option<String> {
    let marker = format!("{name}=\"");
    let rest = tag.split_once(&marker)?.1;
    Some(
        rest.split_once('"')?
            .0
            .replace("&amp;", "&")
            .replace("&quot;", "\""),
    )
}

fn category_name(tag_type: i64) -> &'static str {
    match tag_type {
        1 => "artist",
        3 => "copyright",
        4 => "character",
        5 => "meta",
        _ => "general",
    }
}

fn extension_of(url: &str) -> String {
    url.split(['?', '#'])
        .next()
        .unwrap_or_default()
        .rsplit('.')
        .next()
        .unwrap_or_default()
        .to_lowercase()
}

pub(super) trait StringFallback {
    fn fallback(self, value: &str) -> String;
}
impl StringFallback for String {
    fn fallback(self, value: &str) -> String {
        if self.is_empty() {
            value.into()
        } else {
            self
        }
    }
}

pub(super) fn first_string(post: &Value, keys: &[&str]) -> String {
    keys.iter()
        .map(|key| string(post.get(*key)))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

impl Gelbooru {
    fn api(&self) -> String {
        format!("{}/index.php", self.api_origin)
    }

    fn credentials(
        &self,
        credentials: &HashMap<String, String>,
    ) -> Result<Vec<(String, String)>, String> {
        if !self.api_key_required {
            return Ok(Vec::new());
        }
        let auth = auth(credentials);
        if auth.is_empty() {
            Err(format!(
                "{} requires User ID and API Key. Open Settings > Booru Gallery > Accounts.",
                self.display_name
            ))
        } else {
            Ok(auth)
        }
    }

    // tbib omits the URL fields; they follow the standard 0.2 layout
    fn derived_url(
        &self,
        post: &Value,
        folder: &str,
        prefix: &str,
        extension: Option<&str>,
    ) -> String {
        let directory = string(post.get("directory"));
        let image = string(post.get("image"));
        if directory.is_empty() || image.is_empty() {
            return String::new();
        }
        let name = match extension {
            Some(extension) => {
                let stem = image
                    .rsplit_once('.')
                    .map_or(image.as_str(), |(stem, _)| stem);
                format!("{prefix}{stem}.{extension}")
            }
            None => image,
        };
        format!("{}/{folder}/{directory}/{name}", self.origin)
    }

    fn preview_url(&self, post: &Value) -> String {
        first_string(post, &["preview_url", "sample_url"]).fallback(&self.derived_url(
            post,
            "thumbnails",
            "thumbnail_",
            Some("jpg"),
        ))
    }

    pub(super) fn sample_url(&self, post: &Value) -> String {
        string(post.get("sample_url")).fallback(&if post.get("sample").is_some_and(truthy) {
            self.derived_url(post, "samples", "sample_", Some("jpg"))
        } else {
            self.file_url(post)
        })
    }

    fn file_url(&self, post: &Value) -> String {
        first_string(post, &["file_url", "source"])
            .fallback(&self.derived_url(post, "images", "", None))
    }

    pub(super) fn summary(&self, post: &Value) -> PostSummary {
        let id = string(post.get("id"));
        PostSummary {
            source: self.source.into(),
            post_id: id.clone(),
            post_url: format!("{}/index.php?page=post&s=view&id={id}", self.origin),
            preview_url: self.preview_url(post),
            sample_url: self.sample_url(post),
            width: as_u64(post.get("width")),
            height: as_u64(post.get("height")),
            rating: string(post.get("rating")).fallback(self.default_rating),
            created_at: string(post.get("created_at")),
            favorite: None,
            score: as_i64(post.get("score")),
            fav_count: as_i64(post.get("fav_count")),
        }
    }

    pub(super) fn detail_from(&self, post: &Value) -> PostDetail {
        let mut detail = PostDetail::from_summary(self.summary(post));
        detail.media_url = self.file_url(post);
        detail.sample_url = self.sample_url(post).fallback(&self.preview_url(post));
        detail.file_ext = extension_of(&detail.media_url);
        detail.file_size = as_u64(post.get("file_size"));
        detail.tags = group_as_general(&split_tags(post.get("tags")));
        detail.complete = false;
        detail
    }

    fn posts(
        &self,
        client: &Client,
        params: Vec<(String, String)>,
        credentials: &HashMap<String, String>,
    ) -> Result<Vec<Value>, String> {
        let mut query = vec![
            ("page".into(), "dapi".into()),
            ("s".into(), "post".into()),
            ("q".into(), "index".into()),
            ("json".into(), "1".into()),
        ];
        query.extend(params);
        query.extend(self.credentials(credentials)?);
        let raw = send_json(self.source, client.get(self.api()).query(&query))?;
        if let Some(message) = raw.as_str() {
            return Err(format!("{}: {message}", self.display_name));
        }
        Ok(raw
            .as_array()
            .cloned()
            .or_else(|| raw.get("post").and_then(Value::as_array).cloned())
            .unwrap_or_default())
    }

    fn tag_items(
        &self,
        client: &Client,
        names: &[String],
        credentials: &HashMap<String, String>,
    ) -> Result<Vec<Value>, String> {
        let mut params = vec![
            ("page".into(), "dapi".into()),
            ("s".into(), "tag".into()),
            ("q".into(), "index".into()),
            ("json".into(), "1".into()),
            ("names".into(), names.join(" ")),
            ("limit".into(), "100".into()),
        ];
        params.extend(self.credentials(credentials)?);
        let raw = send_json(self.source, client.get(self.api()).query(&params))?;
        Ok(raw
            .as_array()
            .cloned()
            .or_else(|| raw.get("tag").and_then(Value::as_array).cloned())
            .unwrap_or_default())
    }

    fn tag_type_xml(
        &self,
        client: &Client,
        name: &str,
        credentials: &HashMap<String, String>,
    ) -> Result<Option<i64>, String> {
        let mut params = vec![
            ("page".into(), "dapi".into()),
            ("s".into(), "tag".into()),
            ("q".into(), "index".into()),
            ("name".into(), name.into()),
            ("limit".into(), "1".into()),
        ];
        params.extend(self.credentials(credentials)?);
        for attempt in 0..2 {
            let response = client
                .get(self.api())
                .query(&params)
                .header(ACCEPT, "application/xml")
                .send();
            match response {
                Ok(response) if response.status().is_success() => {
                    let body = response.text().map_err(|e| e.to_string())?;
                    for tag in body.split("<tag ").skip(1) {
                        if attribute(tag, "name").as_deref() == Some(name) {
                            return Ok(attribute(tag, "type").and_then(|value| value.parse().ok()));
                        }
                    }
                    return Ok(None);
                }
                Ok(response)
                    if attempt == 0
                        && (response.status() == StatusCode::NOT_FOUND
                            || response.status() == StatusCode::TOO_MANY_REQUESTS) =>
                {
                    thread::sleep(Duration::from_secs(1))
                }
                Ok(response) => {
                    return Err(format!(
                        "{} tag lookup returned {}",
                        self.source,
                        response.status()
                    ))
                }
                Err(_) if attempt == 0 => thread::sleep(Duration::from_secs(1)),
                Err(error) => return Err(format!("{} tag lookup failed: {error}", self.source)),
            }
        }
        unreachable!()
    }
}

impl Provider for Gelbooru {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            source: self.source,
            display_name: self.display_name,
            ratings: self.ratings,
            sort_values: &["latest", "score"],
            pagination: "pid",
            max_page_size: self.max_limit,
            auth_fields: if self.api_key_required {
                &["userId", "apiKey"]
            } else {
                &[]
            },
            categorized_tags: true,
            favorite_read: self.favorites,
            favorite_write: false,
            ranking_periods: &[],
            page_jump: true,
            detail_hydration: true,
            download: true,
            auth_required: self.api_key_required,
            tag_search: true,
            max_search_tags: None,
            credentials_url: self.credentials_url,
        }
    }

    fn media_hosts(&self) -> &'static [&'static str] {
        self.media_hosts
    }

    fn cursor_for_page(&self, page: usize) -> String {
        page.max(1).saturating_sub(1).to_string()
    }

    fn media_referer(&self) -> Option<&'static str> {
        self.media_referer
    }

    fn search(
        &self,
        client: &Client,
        request: &SearchRequest,
        credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        let pid = request
            .cursor
            .as_deref()
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        let limit = request.limit.clamp(1, self.max_limit);
        let mut tags = request.query.trim().to_string();
        if request.ratings.len() == 1 {
            tags = format!("{tags} rating:{}", request.ratings[0])
                .trim()
                .into();
        }
        if request.sort == "score" {
            tags = format!("{tags} sort:score:desc").trim().into();
        } else if request.sort == "random" {
            tags = format!("{tags} sort:random").trim().into();
        }
        let raw = self.posts(
            client,
            vec![
                ("tags".into(), tags),
                ("pid".into(), pid.to_string()),
                ("limit".into(), limit.to_string()),
            ],
            credentials,
        )?;
        let candidates: Vec<_> = raw
            .iter()
            .filter(|post| post.get("id").is_some() && is_static_post(post))
            .collect();
        let visible: Vec<_> = candidates
            .iter()
            .copied()
            .filter(|post| !is_blacklisted(post, blacklist))
            .collect();
        let mapped = visible
            .iter()
            .map(|post| self.summary(post))
            .filter(|post| rating_matches(self.source, &post.rating, &request.ratings))
            .collect();
        Ok(Page {
            posts: mapped,
            next_cursor: (raw.len() == limit).then(|| (pid + 1).to_string()),
            ended: raw.len() < limit,
            warnings: if visible.len() < candidates.len() {
                vec!["local-blacklist-filtered".into()]
            } else {
                Vec::new()
            },
            page: pid + 1,
            total: None,
        })
    }

    fn detail(
        &self,
        client: &Client,
        post_id: &str,
        credentials: &HashMap<String, String>,
    ) -> Result<PostDetail, String> {
        let post = self
            .posts(
                client,
                vec![("id".into(), post_id.into()), ("limit".into(), "1".into())],
                credentials,
            )?
            .into_iter()
            .next()
            .ok_or_else(|| format!("{} post {post_id} was not found", self.source))?;
        Ok(self.detail_from(&post))
    }

    fn classify_tags(
        &self,
        client: &Client,
        tags: &[String],
        credentials: &HashMap<String, String>,
    ) -> Result<HashMap<String, Vec<String>>, String> {
        let mut result: HashMap<String, Vec<String>> = CATEGORY_ORDER
            .into_iter()
            .map(|key| (key.into(), Vec::new()))
            .collect();
        if self.json_tag_lookup {
            for chunk in tags.chunks(100) {
                let known: HashMap<String, &str> = self
                    .tag_items(client, chunk, credentials)?
                    .iter()
                    .filter_map(|tag| {
                        Some((
                            tag.get("name")?.as_str()?.into(),
                            category_name(as_i64(tag.get("type"))),
                        ))
                    })
                    .collect();
                for tag in chunk {
                    result
                        .entry(known.get(tag).copied().unwrap_or("general").into())
                        .or_default()
                        .push(tag.clone());
                }
            }
        } else {
            for tag in tags {
                let category = self
                    .tag_type_xml(client, tag, credentials)
                    .ok()
                    .flatten()
                    .map_or("general", category_name);
                result.entry(category.into()).or_default().push(tag.clone());
                thread::sleep(Duration::from_millis(75));
            }
        }
        Ok(result)
    }

    fn known_tags(
        &self,
        client: &Client,
        names: &[String],
        credentials: &HashMap<String, String>,
    ) -> Result<HashSet<String>, String> {
        let mut known = HashSet::new();
        if self.json_tag_lookup {
            for chunk in names.chunks(100) {
                for tag in self.tag_items(client, chunk, credentials)? {
                    if tag.get("count").is_none() || as_i64(tag.get("count")) > 0 {
                        if let Some(name) = tag.get("name").and_then(Value::as_str) {
                            known.insert(name.to_lowercase());
                        }
                    }
                }
            }
        } else {
            for name in names {
                if self
                    .tag_type_xml(client, name, credentials)
                    .ok()
                    .flatten()
                    .is_some()
                {
                    known.insert(name.to_lowercase());
                }
                thread::sleep(Duration::from_millis(75));
            }
        }
        Ok(known)
    }

    fn favorites(
        &self,
        client: &Client,
        request: &FavoritesRequest,
        credentials: &HashMap<String, String>,
        blacklist: &HashSet<String>,
    ) -> Result<Page, String> {
        if !self.favorites {
            return Err(format!(
                "{} does not support account favorites",
                self.source
            ));
        }
        let user = credentials
            .get("userId")
            .filter(|v| !v.is_empty())
            .ok_or_else(|| format!("{} User ID is required to read favorites", self.source))?;
        self.search(
            client,
            &SearchRequest {
                source: self.source.into(),
                query: format!("fav:{user}"),
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
}

#[cfg(test)]
mod tests {
    use super::super::sources::{RULE34, SAFEBOORU, TBIB};
    use super::*;

    #[test]
    fn accepts_copied_account_fragment() {
        let credentials = HashMap::from([("apiKey".into(), "&api_key=secret&user_id=42".into())]);
        assert_eq!(
            auth(&credentials),
            [
                ("user_id".into(), "42".into()),
                ("api_key".into(), "secret".into())
            ]
        );
    }

    #[test]
    fn parses_tag_xml_attributes() {
        let tag = r#"name="blue_hair" count="2" type="0" />"#;
        assert_eq!(attribute(tag, "name").as_deref(), Some("blue_hair"));
        assert_eq!(attribute(tag, "type").as_deref(), Some("0"));
    }

    #[test]
    fn derives_tbib_media_urls_from_directory_and_image() {
        let post = serde_json::json!({
            "id": 28617588, "directory": 4137, "image": "0c4dedfe.jpg",
            "hash": "6131079c", "sample": true, "rating": "general", "tags": "1girl solo"
        });
        let detail = TBIB.detail_from(&post);
        assert_eq!(
            detail.preview_url,
            "https://tbib.org/thumbnails/4137/thumbnail_0c4dedfe.jpg"
        );
        assert_eq!(
            detail.sample_url,
            "https://tbib.org/samples/4137/sample_0c4dedfe.jpg"
        );
        assert_eq!(
            detail.media_url,
            "https://tbib.org/images/4137/0c4dedfe.jpg"
        );
        assert_eq!(detail.file_ext, "jpg");
        assert_eq!(
            detail.post_url,
            "https://tbib.org/index.php?page=post&s=view&id=28617588"
        );
        let unsampled =
            serde_json::json!({"id": 1, "directory": 4, "image": "a.png", "sample": false});
        assert_eq!(
            TBIB.sample_url(&unsampled),
            "https://tbib.org/images/4/a.png"
        );
        assert!(is_static_post(&post));
        let safe = serde_json::json!({"id": 2, "preview_url": "https://safebooru.org/t.jpg"});
        assert_eq!(SAFEBOORU.summary(&safe).rating, "safe");
    }

    #[test]
    fn rule34_uses_api_host_and_requires_key() {
        assert_eq!(RULE34.api(), "https://api.rule34.xxx/index.php");
        assert_eq!(
            RULE34.summary(&serde_json::json!({"id": 7})).post_url,
            "https://rule34.xxx/index.php?page=post&s=view&id=7"
        );
        assert!(RULE34.credentials(&HashMap::new()).is_err());
        assert!(TBIB.credentials(&HashMap::new()).unwrap().is_empty());
        assert_eq!(RULE34.capabilities().auth_fields, ["userId", "apiKey"]);
    }
}
