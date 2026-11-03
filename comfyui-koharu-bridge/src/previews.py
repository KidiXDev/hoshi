import hashlib
import logging
import os
from contextlib import suppress
from pathlib import Path

import folder_paths
from PIL import Image, ImageOps

logger = logging.getLogger("Koharu-Bridge")

# Cache directories
BRIDGE_DIR = Path(__file__).resolve().parents[1]
BRIDGE_CACHE_DIR = BRIDGE_DIR / "cache"
BRIDGE_THUMB_DIR = BRIDGE_CACHE_DIR / "thumbnails"
with suppress(OSError):
    BRIDGE_THUMB_DIR.mkdir(parents=True, exist_ok=True)

# Check yet_essential custom_node thumbnails if present to share disk cache
CUSTOM_NODES_DIR = BRIDGE_DIR.parent
YE_THUMB_DIR = CUSTOM_NODES_DIR / "yet_essential" / "cache" / "thumbnails"


def find_model_preview(category: str, filename: str) -> str | None:
    categories = [category]
    if category in ["unet", "diffusion_models"]:
        categories = ["unet", "diffusion_models", "checkpoints"]
    elif category == "checkpoints":
        categories = ["checkpoints", "diffusion_models", "unet"]
    elif category in ["lora", "loras"]:
        categories = ["loras", "lora"]
    elif category in ["clip", "text_encoders"]:
        categories = ["clip", "text_encoders"]
    elif category == "vae":
        categories = ["vae"]

    for cat in categories:
        try:
            model_path = folder_paths.get_full_path(cat, filename)
            if not model_path or not os.path.exists(model_path):
                continue

            base = os.path.splitext(model_path)[0]
            dir_name = os.path.dirname(model_path)
            base_name = os.path.basename(base)

            extensions = [
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".preview.png",
                ".preview.jpg",
                ".preview.webp",
            ]
            for ext in extensions:
                p = base + ext
                if os.path.exists(p) and os.path.isfile(p):
                    return p

            preview_dir = os.path.join(dir_name, ".preview")
            if os.path.exists(preview_dir):
                for ext in extensions:
                    p = os.path.join(preview_dir, base_name + ext)
                    if os.path.exists(p) and os.path.isfile(p):
                        return p

            try:
                for item in os.listdir(dir_name):
                    if item.lower().startswith(base_name.lower()) and any(
                        item.lower().endswith(ext)
                        for ext in [".png", ".jpg", ".jpeg", ".webp"]
                    ):
                        candidate = os.path.join(dir_name, item)
                        if os.path.isfile(candidate):
                            return candidate
            except Exception:
                pass
        except Exception:
            continue
    return None


def get_or_create_thumbnail(orig_path: str, size: int = 300) -> str:
    """
    Returns an optimized WebP thumbnail path.
    Reuses existing yet_essential thumbnails if found, or generates and caches one.
    """
    try:
        orig_p = Path(orig_path)
        if not orig_p.is_file():
            return orig_path

        mtime_ns = orig_p.stat().st_mtime_ns
        path_hash = hashlib.sha1(str(orig_p).encode("utf-8")).hexdigest()[:12]
        thumb_name = f"{orig_p.stem}_{path_hash}_{mtime_ns}_{size}.webp"

        if YE_THUMB_DIR.exists():
            ye_thumb = YE_THUMB_DIR / thumb_name
            if ye_thumb.is_file():
                return str(ye_thumb)

        bridge_thumb = BRIDGE_THUMB_DIR / thumb_name
        if bridge_thumb.is_file():
            return str(bridge_thumb)

        with Image.open(orig_p) as img:
            img = ImageOps.exif_transpose(img)
            if img.width > size or img.height > size:
                img.thumbnail((size, size), Image.Resampling.LANCZOS)

            # Convert mode if needed for clean WEBP encoding
            if img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info
            ):
                img.save(bridge_thumb, "WEBP", quality=80, method=4)
            else:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                img.save(bridge_thumb, "WEBP", quality=80, method=4)

        return str(bridge_thumb)
    except Exception as e:
        logger.warning(f"Failed to generate thumbnail for {orig_path}: {e}")
        return orig_path
