use super::super::gelbooru::Gelbooru;

pub static SAFEBOORU: Gelbooru = Gelbooru {
    source: "safebooru",
    display_name: "Safebooru",
    origin: "https://safebooru.org",
    api_origin: "https://safebooru.org",
    media_hosts: &["safebooru.org", "images.safebooru.org"],
    ratings: &["safe"],
    default_rating: "safe",
    max_limit: 1000,
    credentials_url: "",
    api_key_required: false,
    json_tag_lookup: false,
    favorites: false,
    media_referer: None,
};
