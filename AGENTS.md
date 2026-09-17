# AGENTS.md

Context and guidelines for AI agents working on **Hoshi** (codename **Koharu**), a Tauri v2 + Vue 3 desktop frontend for ComfyUI.

---

## 1. Naming

- **Hoshi** is the brand: everything a user reads (window title, About page, assistant persona, release names, README). Frontend code imports it from `src/lib/brand.ts` (`BRAND_NAME`, `REPO_SLUG`, `REPO_URL`); Rust reads `productName` from `src-tauri/tauri.conf.json` via `app_handle.package_info().name`. Never hard-code the brand string anywhere else.
- **Koharu** is the codename: package/crate names, the Tauri identifier, URI schemes (`koharu-image://`, `koharu-model://`, `koharu-library://`), bridge endpoints (`/koharu/*`), the `comfyui-koharu-bridge` custom node, postMessage channels, user agents, temp/cache directory names, upload filenames and client IDs. These are literals and never change with the brand.
- Rebranding = edit `src/lib/brand.ts`, `productName`/`mainBinaryName`/window `title` in `tauri.conf.json`, the names in `.github/workflows/release.yml`, `README.md`, and swap `src/assets/app-logo.png`.

---

## 2. Project Overview

- **Application Type**: Desktop application (Tauri v2 + Vue 3)
- **Package Manager / Runtime**: [Bun](https://bun.sh)
- **Frontend**: Vue 3 (`<script setup lang="ts">`), TypeScript, Tailwind CSS v4, shadcn-vue
- **Backend**: Rust in `src-tauri/`
- **Purpose**: ComfyUI process launcher and studio for the Anima model family — workflow generation, post-processing tools, output gallery, booru/Animadex/Civitai browsing, library and model management, embedded ComfyUI editor, and an AI prompt assistant.

---

## 3. Tech Stack & Libraries

| Category           | Technology / Library                                                         | Description                                                             |
| :----------------- | :--------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| **Framework**      | Vue 3 (`vue`)                                                                | Reactive UI with TypeScript (`<script setup lang="ts">`)                |
| **Desktop Shell**  | Tauri v2 (`@tauri-apps/api`, `@tauri-apps/cli`)                              | Native container with IPC invoke, events and custom URI schemes         |
| **Native Dialogs** | `rfd`                                                                        | Native OS file & folder pickers                                         |
| **Build Tool**     | Vite                                                                         | Bundler and dev server (port 1420)                                      |
| **Styling**        | Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`)                         | Utility CSS via `@import "tailwindcss";`                                |
| **UI Components**  | shadcn-vue (`reka-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`) | Headless components generated into `src/components/ui/`                 |
| **Icons**          | Lucide (`@lucide/vue`)                                                       | Icon set                                                                |
| **State**          | Pinia (`pinia`)                                                              | Mutable UI/session state (`src/stores/`)                                |
| **Server state**   | TanStack Query (`@tanstack/vue-query`)                                       | Cached reads from ComfyUI, Civitai, Animadex, booru and the model index |
| **Routing**        | Vue Router (`vue-router`)                                                    | One view per route (`src/router/index.ts`)                              |
| **Virtualization** | TanStack Virtual (`@tanstack/vue-virtual`)                                   | Virtualized galleries and grids                                         |
| **AI**             | Vercel `ai` + `@openrouter/ai-sdk-provider`                                  | Maya assistant, prompt enhancer, session titling                        |
| **HTTP**           | `axios` (frontend), `reqwest` (Rust)                                         | ComfyUI REST and third-party APIs                                       |
| **Linter**         | Oxlint                                                                       | `src/components/ui/**` is ignored                                       |
| **Formatter**      | Prettier                                                                     | `prettier-plugin-organize-imports` + `prettier-plugin-tailwindcss`      |

---

## 4. Project Structure

```
koharu/
├── comfyui-koharu-bridge/        # Bridge custom node, compiled into the Rust binary and injected into ComfyUI
│   ├── __init__.py               # /koharu/models, /koharu/system, /koharu/health, /koharu/refresh, /koharu/shutdown, /koharu/model_preview
│   └── web/workspace.js          # Runs inside the embedded ComfyUI iframe; postMessage bridge for workflow import
├── src/
│   ├── assets/                   # app-logo.png, maya-mascot.png
│   ├── components/
│   │   ├── ai/ animadex/ booru/ civitai/ danbooru/ gallery/ library/ models/ prompt/ remove-background/ settings/
│   │   ├── common/               # Shared widgets (dialogs, selectors, image comparison, seed control, …)
│   │   ├── layout/               # Page/studio layout primitives, settings rows, banners
│   │   ├── template/             # App shell (AppTitlebar, AppSidebar, TerminalDrawer, AiAssistantDrawer) and generator sections
│   │   └── ui/                   # shadcn-vue generated primitives (do not hand-edit)
│   ├── composables/              # TanStack Query hooks (use*Queries.ts, queryKeys.ts) and UI composables
│   ├── data/                     # aiPrompts.ts (assistant system prompts), promptSuggestions.ts
│   ├── lib/                      # brand.ts, queryClient.ts, utils.ts (cn)
│   ├── router/index.ts
│   ├── services/                 # Thin clients: comfyApi.ts, comfyWs.ts, workflowBuilder.ts, one *.ts per Rust module
│   ├── stores/                   # Pinia stores (comfyStore, workflowStore, launcherStore, aiStore, …)
│   ├── types/                    # comfy.ts, workflow.ts, launcher.ts, library.ts, ai.ts, animadex.ts, imageBatch.ts
│   ├── utils/                    # Pure helpers (promptTools, dynamicPrompt, logFormatter, …) with *.test.* beside them
│   ├── views/                    # One file per route
│   ├── App.vue  main.ts  main.css  version.ts
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs                # Tauri setup, command registration, URI scheme handlers, app data storage
│   │   ├── main.rs
│   │   ├── process_manager.rs    # Spawn/stop ComfyUI, bridge injection, model discovery (local_model_discovery.py)
│   │   ├── image_gallery.rs      # Output index + thumbnail cache
│   │   ├── model_manager.rs      # Local model index, hashing, Civitai sync, previews
│   │   ├── library_manager.rs  preset_manager.rs  prompt_suggestions.rs  download_manager.rs
│   │   ├── civitai.rs  animadex.rs  danbooru_wiki.rs  network_cache.rs
│   │   └── booru/                # Provider trait (mod.rs) + API engines danbooru/gelbooru/moebooru; sources/ has one file per site
│   ├── Cargo.toml  tauri.conf.json  capabilities/default.json
├── tests/                        # Standalone *.check.* scripts (not picked up by `bun test`)
├── .github/workflows/release.yml # v* tag → Windows NSIS + portable zip
└── package.json  vite.config.ts  tsconfig.json  components.json
```

---

## 5. Key Architecture

1. **Process manager (`src-tauri/src/process_manager.rs`)** — spawns ComfyUI with the configured Python, resolves relative paths against the ComfyUI directory, forces `PYTHONUNBUFFERED=1` / `PYTHONIOENCODING=utf-8` and `--enable-cors-header`, streams `comfyui-log` / `comfyui-status` events, and writes the bridge custom node into `custom_nodes/comfyui-koharu-bridge/` before every launch (removing the pre-rebrand `comfyui-comfygui-bridge/` folder if present).

2. **Bridge custom node (`comfyui-koharu-bridge/`)** — `__init__.py` and `web/workspace.js` are embedded with `include_str!`; editing them changes what gets injected. Endpoints: `GET /koharu/models`, `GET /koharu/system`, `GET /koharu/health`, `POST /koharu/refresh`, `POST /koharu/shutdown`, `GET /koharu/model_preview`. `workspace.js` registers the `Koharu.Workspace` extension and bridges `postMessage` (channel `koharu-workspace`, query param `koharuSession`) to `src/composables/useComfyUiWorkspace.ts`.

3. **Frontend ↔ Rust** — every `#[tauri::command]` must be listed in `generate_handler![...]` in `lib.rs`. Components never call `invoke` directly; each Rust module has a client in `src/services/`. Persistent key/value data goes through `src/services/appStorage.ts`. Custom URI schemes `koharu-image`, `koharu-model`, `koharu-library`, `booru-image`, `danbooru-image` serve local/cached media to the webview.

4. **Frontend ↔ ComfyUI** — `comfyApi.ts` (REST + bridge endpoints), `comfyWs.ts` (execution events and binary preview frames), `workflowBuilder.ts` (+ `faceDetailerWorkflow.ts`, `ultimateUpscaleWorkflow.ts`) turns `WorkflowState` into an API-format prompt graph; `prepareWorkflowForQueue` resolves seeds and `{a|b}` dynamic prompts.

5. **Frameless window** — `decorations: false`; `AppTitlebar.vue` provides drag region, breadcrumb, server toggle, and window controls under `capabilities/default.json` permissions.

6. **Gallery** — `image_gallery.rs` persists an output index and thumbnails in the app cache; the viewer restores the cached index first, then rescans in the background.

7. **Library & presets** — `library_manager.rs` stores prompts, LoRA presets and characters as JSON with JPEG thumbnails; LoRA presets only replace the LoRA stack.

---

## 6. Conventions

1. **Prettier plugin order** — `prettier-plugin-tailwindcss` must stay last in `.prettierrc`.
2. **Components** — SFCs with `<script setup lang="ts">`, Composition API, Pinia composables. Shared primitives in `src/components/ui/`, app shell in `src/components/template/`.
3. **Path sanitization** — strip surrounding quotes from path inputs in both frontend and backend.
4. **Validation** — `bun run lint` + `bun run typecheck`; never `bun run build` for routine checks.
5. **Select** — always the shadcn-vue `Select` suite, items wrapped in `<SelectGroup class="max-h-40 overflow-y-auto">`; canonical Tailwind classes over arbitrary values.
6. **Comments** — none, except short section markers and `ponytail:` notes for deliberate simplifications.
7. **Tests** — `*.test.{ts,js}` next to the code, `bun:test` + `node:assert/strict`, `setActivePinia(createPinia())` for stores.

---

## 7. Commands

```bash
bun run dev                                      # vite only
bun run tauri dev                                # desktop app
bun run lint
bun run typecheck
bun test
bun test src/services/workflowBuilder.test.ts
bun run format
bun run format:check
cargo check --manifest-path src-tauri/Cargo.toml
bun run tauri build                              # only when asked
```
