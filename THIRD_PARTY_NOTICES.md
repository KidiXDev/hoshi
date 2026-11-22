# Third-party notices

Hoshi is licensed under the [GNU General Public License, version 3](LICENSE). This file lists the
third-party work Hoshi includes or needs, and the licence each one comes with.

## Included in Hoshi

### ComfyUI-Character-Helper

- Source: <https://github.com/Adamovix/ComfyUI-Character-Helper>
- Licence: MIT
- Used for: Character Helper. The default tag rules (`field_rules.jsonc`) and build settings
  (`build_settings.jsonc`) come from this project. The usual look, suggestions and dice are a Rust
  port of its tag database, and the dataset build is a rewrite of its `build_db.py`.

```text
MIT License

Copyright (c) 2026 Adamovix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Character Helper dataset sources

These datasets are not shipped with Hoshi. They are downloaded from Hugging Face when you build the
Character Helper dataset in Settings, and the database made from them stays on your computer. The
tags, aliases and counts in them come from [Danbooru](https://danbooru.donmai.us) and its community.

| Dataset                                                                                          | Used for                                                   | Licence   |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------- |
| [nyanko-devs/danbooru2026](https://huggingface.co/datasets/nyanko-devs/danbooru2026)             | Post data: tag counts, character statistics, dice pictures | MIT       |
| [Mexes/danbooru-tag-taxonomy](https://huggingface.co/datasets/Mexes/danbooru-tag-taxonomy)       | Sorting tags into fields, tag aliases                      | CC BY 4.0 |
| [itterative/danbooru_wikis_full](https://huggingface.co/datasets/itterative/danbooru_wikis_full) | Danbooru wiki tag groups and tag implications              | MIT       |
| [Jio7/danbooru-tags-classified](https://huggingface.co/datasets/Jio7/danbooru-tags-classified)   | A second opinion for tags nothing else sorts               | MIT       |

If ComfyUI's Python doesn't have [pyarrow](https://arrow.apache.org/docs/python/) (Apache 2.0), the
build installs it into its temporary download folder and deletes it when the build is done.

## Required, installed separately

Hoshi uses these through ComfyUI. They are not bundled with Hoshi. You install them yourself, and
each one keeps its own licence.

| Project                                                                         | Used for                         | Licence  |
| ------------------------------------------------------------------------------- | -------------------------------- | -------- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI)                                 | Running every generation         | GPL-3.0  |
| [ComfyUI-WD-Timm-Tagger](https://github.com/bedovyy/ComfyUI-WD-Timm-Tagger)     | WD Tagger                        | MIT      |
| [ComfyUI_UltimateSDUpscale](https://github.com/ssitu/ComfyUI_UltimateSDUpscale) | Tiled upscaling                  | GPL-3.0  |
| [ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack)          | Face Detailer                    | GPL-3.0  |
| [ComfyUI-Impact-Subpack](https://github.com/ltdrdata/ComfyUI-Impact-Subpack)    | Face detection for Face Detailer | AGPL-3.0 |
| [ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG)                         | Remove Background                | GPL-3.0  |
| [ComfyUI-Spectrum-MOSS](https://github.com/Rkkss/ComfyUI-Spectrum-MOSS)         | Faster MOSS-Image generation     | GPL-3.0  |
