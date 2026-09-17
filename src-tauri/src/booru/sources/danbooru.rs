use super::super::danbooru::Danbooru;

pub static DANBOORU: Danbooru = Danbooru {
    source: "danbooru",
    display_name: "Danbooru",
    base: "https://danbooru.donmai.us",
    media_hosts: &["cdn.donmai.us", "danbooru.donmai.us"],
    ratings: &["general", "sensitive", "questionable", "explicit"],
    accounts: true,
    credentials_url: "https://danbooru.donmai.us/settings",
};
