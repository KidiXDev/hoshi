use super::super::moebooru::Moebooru;

pub static YANDERE: Moebooru = Moebooru {
    source: "yandere",
    display_name: "yande.re",
    base: "https://yande.re",
    media_hosts: &["yande.re", "files.yande.re", "assets.yande.re"],
    ratings: &[],
    cookie_auth: false,
};
