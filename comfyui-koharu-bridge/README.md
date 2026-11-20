# Koharu bridge

This custom node provides the desktop app's ComfyUI endpoints and workspace extension.
The launcher injects the bridge into ComfyUI, which supplies its runtime dependencies.

- `__init__.py` is the custom node entry point.
- `src/routes.py` registers the HTTP endpoints and origin guard.
- `src/models.py` discovers models, samplers, and schedulers.
- `src/previews.py` finds model artwork and caches thumbnails.
- `src/nodes.py` holds the sampler (variation seed, progressive resolution), scaling and save nodes.
- `src/mg_cache.py` and `src/mg_calibration.py` implement MG-Cache; calibrations are stored in ComfyUI's `user/koharu/mg_cache/`.
- `src/accelerators.py` holds the MOSS Image model nodes: MG-Cache, guidance interval and text embedder cache.
- `src/moss_booster.py` holds MOSS Booster: one-time LoRA baking and INT8 attention through `comfy_kitchen`.
- `web/workspace.js` registers the ComfyUI frontend extension.

Run these commands from this directory with uv installed.

```sh
uv run ruff check .
uv run ruff format .
uv run ruff format --check .
```

Run the accelerator self-check with ComfyUI's Python, passing the ComfyUI folder.

```sh
python tests/test_accelerators.py path/to/ComfyUI
```
