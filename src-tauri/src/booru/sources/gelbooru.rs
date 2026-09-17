use super::super::gelbooru::Gelbooru;

pub static GELBOORU: Gelbooru = Gelbooru {
    source: "gelbooru",
    display_name: "Gelbooru",
    origin: "https://gelbooru.com",
    api_origin: "https://gelbooru.com",
    media_hosts: &["gelbooru.com", "img3.gelbooru.com", "img4.gelbooru.com"],
    ratings: &["general", "sensitive", "questionable", "explicit"],
    default_rating: "",
    max_limit: 100,
    credentials_url: "https://gelbooru.com/index.php?page=account&s=options",
    api_key_required: true,
    json_tag_lookup: true,
    favorites: true,
    media_referer: Some("https://gelbooru.com/"),
};
