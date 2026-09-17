use super::super::gelbooru::Gelbooru;

pub static RULE34: Gelbooru = Gelbooru {
    source: "rule34",
    display_name: "Rule34",
    origin: "https://rule34.xxx",
    api_origin: "https://api.rule34.xxx",
    media_hosts: &[
        "rule34.xxx",
        "api.rule34.xxx",
        "api-cdn.rule34.xxx",
        "api-cdn-mp4.rule34.xxx",
        "wimg.rule34.xxx",
        "us.rule34.xxx",
    ],
    ratings: &["general", "sensitive", "questionable", "explicit"],
    default_rating: "",
    max_limit: 100,
    credentials_url: "https://rule34.xxx/index.php?page=account&s=options",
    api_key_required: true,
    json_tag_lookup: false,
    favorites: false,
    media_referer: Some("https://rule34.xxx/"),
};
