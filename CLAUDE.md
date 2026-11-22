# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Hoshi (codename Koharu): a Tauri v2 (Rust) + Vue 3 desktop frontend for ComfyUI, targeting the Anima model family. Read [AGENTS.md](AGENTS.md) for conventions (shadcn `Select` usage, Tailwind canonical classes, import sorting, path sanitization) and the project tree.

## Naming

- **Hoshi** = brand, only for text a user reads. Frontend: `BRAND_NAME` / `REPO_SLUG` / `REPO_URL` from `src/lib/brand.ts`. Rust: `app_handle.package_info().name` (from `productName` in `tauri.conf.json`). Never hard-code the brand string elsewhere.
- **Koharu** = codename, for every machine-facing identifier: package/crate names, Tauri identifier, URI schemes (`koharu-image`, `koharu-model`, `koharu-library`), bridge endpoints (`/koharu/*`), `comfyui-koharu-bridge`, postMessage channel `koharu-workspace`, user agents, temp dirs, client IDs. These are literal strings and must stay identical across TS, Rust and Python.
- Third-party code, data sources and required custom nodes are listed with their licences in `THIRD_PARTY_NOTICES.md`, which ships next to the exe through `bundle.resources` and the portable zip step in `release.yml`. Update it whenever you add one.
- Rebrand checklist: `src/lib/brand.ts`, `productName` + `mainBinaryName` + window `title` in `src-tauri/tauri.conf.json`, names in `.github/workflows/release.yml`, `README.md`, `src/assets/app-logo.png`.

## Commands

Always use `bun` (never npm/yarn). Rust toolchain required for anything touching `src-tauri/`.

```bash
bun install
bun run tauri dev                       # full desktop app (starts vite on :1420 automatically)
bun run dev                             # vite only, so Tauri `invoke` calls fail in a plain browser
bun run lint                            # oxlint (src/components/ui/** is ignored)
bun run typecheck                       # vue-tsc --noEmit, the preferred routine validation
bun run format                          # oxfmt
bun run test                            # vitest run over every src/**/*.test.ts (NOT `bun test`, which is Bun's own runner)
bun run test src/services/workflowBuilder.test.ts   # single file
bun run test:watch                      # vitest watch mode
cargo check --manifest-path src-tauri/Cargo.toml
bun run tauri build                     # production bundle (slow, only when asked)
```

Do not run `bun run build` for routine validation. It does a full Vite production bundle. Use `lint` + `typecheck`.

Releases: pushing a `v*` tag runs `.github/workflows/release.yml` (Windows-only NSIS + portable zip). `VITE_APP_VERSION` is injected from the tag and read by `src/version.ts`.

## Architecture

Three processes talk to each other:

```
Vue frontend (src/)  ──Tauri invoke/events──▶  Rust backend (src-tauri/src/)
       │                                              │ spawns python main.py
       └──HTTP :8188 + WebSocket──────────────▶  ComfyUI  ◀── bridge custom node injected by Rust
```

### Frontend → Rust (Tauri IPC)

- Every Rust command is registered in the `generate_handler![...]` list in `src-tauri/src/lib.rs`. A new `#[tauri::command]` does nothing until it is added there.
- Frontend never calls `invoke` from components directly. Each Rust module has a thin TS client in `src/services/` (`imageGallery.ts`, `libraryService.ts`, `downloadManager.ts`, `animadexApi.ts`, `booruGallery.ts`, `civitai.ts`, `danbooruWiki.ts`, `promptSuggestionService.ts`). Persistent key/value app data goes through `src/services/appStorage.ts` → `*_app_data_entry` commands in `app_data.rs` (DPAPI-encrypted on Windows, atomic writes). `usePersistedState` wraps load → normalize → debounced save for settings objects.
- Custom-scheme URLs (`koharu-image`, `koharu-model`, …) are built with `customSchemeUrl` in `src/lib/customScheme.ts`, and the Rust handlers share `protocol_response` in `lib.rs`.
- Rust pushes to the frontend via events: `comfyui-log` (ANSI log lines) and `comfyui-status` from `process_manager.rs`, and download progress from `download_manager.rs`.
- Rust modules:
  - `process_manager.rs`: spawn/stop ComfyUI, model discovery.
  - `python/`: embedded Python scripts, plus `mod.rs` for interpreter resolution and the run-script-as-JSON helper.
  - `comfy_update.rs`: update check + portable `update/update.py` runner.
  - `image_gallery.rs`: output index + thumbnail cache.
  - `model_manager.rs`: local model index, hashing, Civitai sync.
  - `library_manager.rs`, `prompt_suggestions.rs`.
  - `word_frequency.rs`: serves a user-supplied wordfreq `*_en.msgpack.gz` from the app config `wordfreq/` folder for MOSS word autocomplete.
  - `tag_autocomplete.rs`: serves the user-supplied Danbooru tag CSVs in the app config `tags/` folder. They are parsed and searched in `src/services/tagAutocomplete.ts`.
  - `wildcards.rs`: reads `wildcards/**/*.txt` from the app config dir. `__name__` tokens are expanded from the seed in `prepareWorkflowForQueue`.
  - `character_data/`: Character Helper, a Rust port of ComfyUI-Character-Helper's tag DB for usual look, autocomplete and dice. Nothing is bundled. The user builds the database once, and every command errors until `character_helper/data/` exists in the app config. `rebuild.rs` runs the embedded `python/character_db_build.py` with ComfyUI's Python against the user-editable, commented `field_rules.jsonc` and `build_settings.jsonc` it writes to `character_helper/` (defaults are the upstream rules). Downloads go to `<chosen folder>/character-helper-build/`, which is deleted after a successful build. Client in `src/services/characterData.ts`, shared state in `characterHelperStore`, assistant tools in `characterDataTools.ts`.
  - `app_data.rs`.
  - `comfy_paths.rs`: the one place that resolves the ComfyUI root (direct or portable `ComfyUI/` layout) and `--base-directory`/`--output-directory`.
  - `download_manager.rs`.
  - `dropped_files.rs`: Windows-only WebView2 bridge that returns real paths for files dropped from Explorer.
  - `civitai.rs`, `animadex.rs`, `danbooru_wiki.rs`, `network_cache.rs`.
  - `booru/`: a `Provider` trait in `mod.rs` and API engines `danbooru.rs`, `gelbooru.rs`, `moebooru.rs`. Each site has one file under `booru/sources/` holding a configured engine static, registered in `sources/mod.rs`. To add a site, add a `sources/<site>.rs` and append it to `ALL`. A site with its own API implements `Provider` directly there, like `aitag.rs`.

### Frontend → ComfyUI (direct network)

- `src/services/comfyApi.ts`: REST client (`/prompt`, `/history`, `/object_info`, plus the bridge's `/koharu/*` endpoints) over `httpClient.ts` (axios, shared error formatting).
- `src/services/comfyWs.ts`: WebSocket for `executing`/`progress`/`executed`/`execution_error` and binary `PREVIEW_IMAGE` frames. It reconnects with backoff.
- `src/services/workflowBuilder.ts`: turns `WorkflowState` (`src/types/workflow.ts`) into a ComfyUI API-format prompt graph. Txt2img, img2img, inpaint, and the FaceDetailer stage (`faceDetailerWorkflow.ts`) all build here, and `prepareWorkflowForQueue` resolves seeds before submission. This is the file to change when adding a node/feature to generation, and it is the most heavily tested one.
- `ComfyApi.waitForHistory` polls a queued prompt until it lands in `/history` (queue-aware, no fixed timeout). The Upscaler / Remove Background / Face Detailer views share `useImageBatch` (queue state) + `useBatchRunner` (upload, queue, collect results, "Send to…" transfers). Image drop zones use `useImageDropZone`.
- Civitai and Model Manager reads go through TanStack Query composables in `src/composables/use*Queries.ts` with keys in `queryKeys.ts`. Pinia stores (`src/stores/`) hold mutable UI/session state (`comfyStore` = connection + live generation, `workflowStore` = parameters, `launcherStore` = process config/logs, `aiStore` = assistant chat).

### The bridge custom node (`comfyui-koharu-bridge/`)

Every file in `BRIDGE_FILES` (`__init__.py`, `src/*.py`, `web/workspace.js`) is compiled into the Rust binary with `include_str!` in `process_manager.rs` and written into ComfyUI's `custom_nodes/comfyui-koharu-bridge/` before every launch (`auto_inject_bridge_node`, which also deletes the pre-rebrand `comfyui-comfygui-bridge/` folder). Editing the Python/JS here changes what gets injected, with no separate install step. A new Python file must also be added to `BRIDGE_FILES`.

Generated graphs use only core nodes, the external packs listed in the README, and the bridge's own nodes:

- `src/nodes.py`: `KoharuKSampler` for variation seeds and progressive resolution, `KoharuScaleToReference` after model upscaling, and `KoharuSaveImage` writing the A1111 `parameters` chunk.
- `src/postfx.py`: `KoharuPostFX`.
- `src/accelerators.py`: the MOSS-only `KoharuMGCache`, `KoharuMGCacheCalibrate`, `KoharuGuidanceInterval` and `KoharuMossTextEmbedderCache`. They are registered only when ComfyUI ships MOSS Image, and applied to the main sampler's model only.
- `src/moss_booster.py`: `KoharuMossBooster`, LoRA baking + INT8 attention, placed right after the LoRA chain so every pass uses it.

The bridge also adds `/koharu/models`, `/koharu/system`, `/koharu/health`, `/koharu/refresh`, `/koharu/shutdown`, `/koharu/model_preview`, plus an origin-guard middleware: Rust launches ComfyUI with `--enable-cors-header=<app origin>`, and the bridge rejects requests whose `Origin` is neither that origin nor ComfyUI itself. `workspace.js` runs inside the embedded ComfyUI iframe and bridges `postMessage` to `src/composables/useComfyUiWorkspace.ts` (allowed parent origins are hard-coded there).

### Frontend layout

- `src/views/`: one file per route (`src/router/index.ts`): workflow, viewer (gallery), booru, animadex, character-helper, civitai (+ model detail), models (Model Manager + detail), upscaler, remove-background, face-detailer, server, library, settings, danbooru-wiki, embedded comfyui.
- `src/components/ui/` is shadcn-vue generated code. It is excluded from lint, so don't hand-edit it unless intentional. Feature components live in sibling folders (`common/`, `layout/`, `booru/`, `civitai/`, `ai/`, …).
- AI assistant (`aiStore.ts`, `aiService.ts`, `src/data/aiPrompts.ts`) uses Vercel `ai` SDK with the OpenRouter provider.
- Window is frameless (`decorations: false`), and the titlebar is a Vue component with `data-tauri-drag-region`.

## Testing conventions

Vitest (`vitest.config.ts`, Node environment by default). Tests are TypeScript, sit next to the code as `*.test.ts`, and import `describe`/`it`/`expect`/`vi` explicitly from `vitest` (no globals). They are type-checked by `bun run typecheck`.

- One behavior per `it`. Build fresh state per test (factories in `src/test/factories.ts`, `deferred()` in `src/test/deferred.ts`) instead of mutating shared fixtures.
- Mock with `vi.mock(import('./module'), async (importOriginal) => ({ ...(await importOriginal()), fn: vi.fn() }))` so the factory is type-checked, and share state with factories through `vi.hoisted`. Use a string path only for deliberate stand-ins that cannot match the real types (e.g. the `ai` SDK or `@openrouter/ai-sdk-provider`).
- Tauri IPC: mock `invoke` from `@tauri-apps/api/core` the same way and assert on its calls.
- Pinia: `setActivePinia(createPinia())` in `beforeEach`. Prefer real stores with `vi.spyOn(store, 'action')` over mocking store modules.
- DOM, composables with lifecycle hooks and components: add `/** @vitest-environment happy-dom */`, mount with `@vue/test-utils` (`enableAutoUnmount(afterEach)`), and await `nextTick`/`flushPromises`. Components using tooltips or portals need a `TooltipProvider` parent and an `#app-content` element, as `App.vue` provides.
- Config already clears mock history, restores `vi.spyOn` spies and unstubs globals between tests.
- Don't write runtime tests against real data. Always use mock data or mocked responses.
