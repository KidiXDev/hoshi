use super::super::moebooru::Moebooru;

pub static KONACHAN_COM: Moebooru = Moebooru {
    source: "konachan.com",
    display_name: "Konachan (R18)",
    base: "https://konachan.com",
    media_hosts: &["konachan.net", "konachan.com"],
    ratings: &["safe", "questionable", "explicit"],
    cookie_auth: true,
};
