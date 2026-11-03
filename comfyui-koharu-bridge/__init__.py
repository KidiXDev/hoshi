"""ComfyUI entry point for the Koharu bridge."""

from .src import routes  # noqa: F401 (registers routes with ComfyUI)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

print("\033[32m[Koharu Bridge]\033[0m Loaded successfully")
