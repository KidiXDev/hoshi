# Hoshi

<p align="center">
  <img src="src/assets/app-logo.png" alt="Hoshi logo" width="120" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <strong>A standalone desktop studio for ComfyUI, built for Anima and MOSS-Image.</strong>
</p>

<p align="center">
  <a href="https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.33.1"><img src="https://img.shields.io/badge/ComfyUI-%3E%3D%20v0.33.1-blue.svg?style=flat-square" alt="ComfyUI >= v0.33.1"/></a>
  <img src="https://img.shields.io/badge/Tauri-v2-orange.svg?style=flat-square" alt="Tauri v2"/>
  <img src="https://img.shields.io/badge/Vue-v3-emerald.svg?style=flat-square" alt="Vue 3"/>
  <img src="https://img.shields.io/badge/TailwindCSS-v4-38bdf8.svg?style=flat-square" alt="Tailwind CSS v4"/>
  <img src="https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square" alt="License"/>
</p>

<p align="center">
  <img src="screenshot/banner.png" alt="Hoshi Studio" />
</p>

> **Work in Progress**: Hoshi is currently under active development. Features and interfaces are subject to change, and you may encounter bugs or incomplete functionality.

## Overview

**Hoshi** is a desktop frontend for ComfyUI aimed at creators who want to generate images with the **[Anima](https://huggingface.co/circlestone-labs/Anima)** model family and **MOSS-Image** without building or maintaining node graphs. It launches and supervises your local ComfyUI, builds the workflow graph for you on every run, and wraps generation, post-processing, model management and reference browsing in one studio-style window.

Hoshi is a Tauri v2 (Rust) + Vue 3 application. It talks to ComfyUI over its normal HTTP/WebSocket API plus a small bridge custom node that Hoshi installs automatically.

## Features

### Generate

- **Workflow Generator** — txt2img and img2img for Anima and MOSS-Image, plus Anima inpainting with a built-in mask painter. Switch model profiles to keep separate generation settings, with resolution presets, sampler/scheduler selection, seed control and variation seeds.
- **MOSS-Image layouts** — draw, move and resize boxes for objects, characters and exact text, with a scene caption and descriptions for each box. Import layout drafts from Maya or the prompt enhancer.
- **Prompting** — tag autocomplete backed by a local suggestion catalog and the ComfyUI server, prompt chips, weight hotkeys, find-in-prompt, negative prompt bundles and `{a|b}` dynamic prompts resolved from the seed.
- **LoRA chain** — stack LoRAs with per-item strength and pull trigger words from Civitai sidecars or safetensors metadata.
- **Pipeline stages** — optional FaceDetailer pass, Ultimate SD Upscale, plain model upscaling and a PostFX pipeline (adjust/style stages); Anima-specific model transforms (AuraFlow sampling, RenormCFG, CacheDiT, LLLite) and MOSS-Image skip layer guidance.
- **Live output** — streaming latent previews, progress, batch queueing, generation history with "reuse settings", and the elapsed-time HUD.

### Post-process

- **Upscaler** — standalone upscale-model or Ultimate SD Upscale tool with before/after comparison.
- **Face Detailer** — run the Impact Pack detailer on any image.
- **Remove Background** — RMBG and BiRefNet modes with mask settings.
- **WD Tagger** — tag an image into a ready-to-use prompt.

### Browse

- **Booru Gallery** — Danbooru, Gelbooru, Safebooru, AI Tag, yande.re and Konachan with per-site credentials, tag autocomplete, a post inspector and a built-in Cloudflare verification window.
- **Animadex** — explore characters and artists, and push their tags straight into the prompt.
- **Civitai** — browse models, inspect versions and samples, and download files with a background download manager.
- **Danbooru Wiki** — read tag wikis in-app with pinned pages and DText rendering.

### Manage

- **Gallery** — indexed output viewer with thumbnails, metadata search (`model:` filters, tags), A/B compare modes and a lightbox inspector.
- **Library** — prompt presets, LoRA presets and character entries (with thumbnails and notes that the assistant can read).
- **Model Manager** — indexes every ComfyUI model folder (including `extra_model_paths.yaml`), hashes files, syncs metadata and previews from Civitai, checks for updates and manages preview images.
- **Embedded ComfyUI editor** — the full ComfyUI frontend inside Hoshi, with one-click "open this generation as a workflow".
- **Server terminal** — launch/stop ComfyUI with your Python and arguments, ANSI-colored log streaming and a log drawer available on every page.

### Maya, the AI assistant

An OpenRouter-powered chat assistant that adapts to the active model profile: Anima tags or MOSS-Image captions and layout drafts. Maya can inspect the current prompt and layout, search Animadex and your character library, apply prompt changes and queue generations. It also drives the inline prompt enhancer and auto-names chat sessions, with separate assistant and enhancer instructions for each model profile.

## Screenshots

### Workflow Generator

Intuitive controls for Anima and MOSS-Image generation, prompt autocomplete, LoRA stacking, and live execution previews.

![Workflow Generator](screenshot/generation.png)

### MOSS-Image Layout Control

Draw, move, and resize bounding boxes for characters, objects, and exact text with regional captions and scene conditioning.

![MOSS-Image Layout Control](screenshot/layout.png)

### MOSS-Image Generation Result

Generation output adhering precisely to regional layout placements and prompt descriptions.

![MOSS-Image Generation Result](screenshot/moss.png)

### Civitai Model Browser

Browse models, inspect versions and preview samples, with background download management.

![Civitai Model Browser](screenshot/civitai.png)

## Requirements

### ComfyUI

- **[v0.42.0](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.33.1) or later.** Hoshi starts ComfyUI with `--enable-cors-header` and injects its bridge node (`custom_nodes/comfyui-koharu-bridge`) before every launch — no manual install needed.

### Models

- Hoshi supports the **[Anima](https://huggingface.co/circlestone-labs/Anima)** family and **MOSS-Image**. Select the matching model profile in the Generation Studio and choose its diffusion model, text encoder and VAE. Other architectures may run but are not supported.

### External custom nodes

Generated graphs use nodes from these packs. Install them into your ComfyUI `custom_nodes/` directory:

- [yet_essential](https://github.com/KidiXDev/yet_essential)
- [ComfyUI-WD-Timm-Tagger](https://github.com/bedovyy/ComfyUI-WD-Timm-Tagger)
- [ComfyUI_UltimateSDUpscale](https://github.com/ssitu/ComfyUI_UltimateSDUpscale)
- [ComfyUI-Impact-Pack](https://github.com/ltdrdata/ComfyUI-Impact-Pack)
- [ComfyUI-Impact-Subpack](https://github.com/ltdrdata/ComfyUI-Impact-Subpack)
- [ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG)

## Install

Windows builds are published on the [Releases](https://github.com/KidiXDev/hoshi/releases) page as an NSIS installer (`Hoshi_<version>_windows_x64-setup.exe`) and a portable zip (`Hoshi_<version>_windows_x64_portable.zip`). The Settings → About page can check for updates.

On first run, open **Settings → ComfyUI** and point Hoshi at your ComfyUI folder (or portable root) and Python executable, then start the server from the titlebar.

## Development

### Prerequisites

- [Bun](https://bun.sh)
- [Rust & Cargo](https://www.rust-lang.org/tools/install) (stable)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

## License

This project is licensed under the [GNU General Public License, version 3](LICENSE).
