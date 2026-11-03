"""ComfyUI entry point for the Koharu bridge."""

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

print("\033[32m[Koharu Bridge]\033[0m Loaded successfully")
