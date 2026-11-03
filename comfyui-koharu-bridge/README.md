# Koharu bridge

This custom node provides the desktop app's ComfyUI endpoints and workspace extension.
The launcher injects the bridge into ComfyUI, which supplies its runtime dependencies.

- `__init__.py` is the custom node entry point.
- `src/routes.py` registers the HTTP endpoints and origin guard.
- `src/models.py` discovers models, samplers, and schedulers.
- `src/previews.py` finds model artwork and caches thumbnails.
- `web/workspace.js` registers the ComfyUI frontend extension.

Run these commands from this directory with uv installed.

```sh
uv run ruff check .
uv run ruff format .
uv run ruff format --check .
```
