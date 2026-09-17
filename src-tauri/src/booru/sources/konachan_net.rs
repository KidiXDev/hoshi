use super::super::moebooru::Moebooru;

pub static KONACHAN_NET: Moebooru = Moebooru {
    source: "konachan.net",
    display_name: "Konachan",
    base: "https://konachan.net",
    media_hosts: &["konachan.net", "konachan.com"],
    ratings: &["safe"],
    cookie_auth: false,
};
