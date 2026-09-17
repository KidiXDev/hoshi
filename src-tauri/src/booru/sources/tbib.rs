use super::super::gelbooru::Gelbooru;

pub static TBIB: Gelbooru = Gelbooru {
    source: "tbib",
    display_name: "TBIB",
    origin: "https://tbib.org",
    api_origin: "https://tbib.org",
    media_hosts: &["tbib.org"],
    ratings: &["general", "sensitive", "questionable", "explicit"],
    default_rating: "",
    max_limit: 100,
    credentials_url: "",
    api_key_required: false,
    json_tag_lookup: false,
    favorites: false,
    media_referer: None,
};
