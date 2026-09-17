use super::super::danbooru::Danbooru;

pub static AIBOORU: Danbooru = Danbooru {
    source: "aibooru",
    display_name: "AIBooru",
    base: "https://aibooru.online",
    media_hosts: &["cdn.aibooru.download", "aibooru.online"],
    ratings: &["general", "sensitive", "questionable", "explicit"],
    accounts: false,
    credentials_url: "",
};
