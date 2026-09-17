use super::super::danbooru::Danbooru;

pub static DANBOORU_SAFE: Danbooru = Danbooru {
    source: "danbooru-safe",
    display_name: "Danbooru (Safe)",
    base: "https://safebooru.donmai.us",
    media_hosts: &["cdn.donmai.us", "safebooru.donmai.us"],
    ratings: &["general"],
    accounts: false,
    credentials_url: "",
};
