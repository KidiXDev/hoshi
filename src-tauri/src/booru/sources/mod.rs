mod aibooru;
mod aitag;
mod danbooru;
mod danbooru_safe;
mod gelbooru;
mod konachan_com;
mod konachan_net;
mod rule34;
mod safebooru;
mod tbib;
mod yandere;

use super::Provider;

pub(crate) use aibooru::AIBOORU;
pub(crate) use aitag::AI_TAG;
pub(crate) use danbooru::DANBOORU;
pub(crate) use danbooru_safe::DANBOORU_SAFE;
pub(crate) use gelbooru::GELBOORU;
pub(crate) use konachan_com::KONACHAN_COM;
pub(crate) use konachan_net::KONACHAN_NET;
pub(crate) use rule34::RULE34;
pub(crate) use safebooru::SAFEBOORU;
pub(crate) use tbib::TBIB;
pub(crate) use yandere::YANDERE;

// Order is the order shown in the gallery's source picker
pub(crate) static ALL: [&dyn Provider; 11] = [
    &DANBOORU,
    &DANBOORU_SAFE,
    &AIBOORU,
    &GELBOORU,
    &RULE34,
    &SAFEBOORU,
    &TBIB,
    &AI_TAG,
    &YANDERE,
    &KONACHAN_NET,
    &KONACHAN_COM,
];

pub(crate) fn all() -> &'static [&'static dyn Provider] {
    &ALL
}

pub(crate) fn by_id(source: &str) -> Result<&'static dyn Provider, String> {
    ALL.iter()
        .copied()
        .find(|provider| provider.capabilities().source == source)
        .ok_or_else(|| format!("unsupported booru source: {source}"))
}
