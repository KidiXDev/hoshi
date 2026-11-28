"""ComfyUI entry point for the Koharu bridge."""

import importlib

from .src import routes  # noqa: F401 (registers routes with ComfyUI)
from .src.nodes import KoharuKSampler, KoharuSaveImage, KoharuScaleToReference
from .src.postfx import KoharuPostFX

NODE_CLASS_MAPPINGS = {
    "KoharuKSampler": KoharuKSampler,
    "KoharuScaleToReference": KoharuScaleToReference,
    "KoharuPostFX": KoharuPostFX,
    "KoharuSaveImage": KoharuSaveImage,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "KoharuKSampler": "Koharu KSampler (Variation)",
    "KoharuScaleToReference": "Koharu Scale To Reference",
    "KoharuPostFX": "Koharu PostFX",
    "KoharuSaveImage": "Koharu Save Image",
}
WEB_DIRECTORY = "./web"

for optional_module in ("accelerators", "moss_booster"):
    try:
        module = importlib.import_module(f".src.{optional_module}", __package__)
    except ImportError as error:
        print(f"\033[33m[Koharu Bridge]\033[0m {optional_module} unavailable: {error}")
    else:
        NODE_CLASS_MAPPINGS.update(module.NODE_CLASS_MAPPINGS)
        NODE_DISPLAY_NAME_MAPPINGS.update(module.NODE_DISPLAY_NAME_MAPPINGS)

print("\033[32m[Koharu Bridge]\033[0m Loaded successfully")
