import asyncio
import signal
import sys
import os
import logging
import hashlib
from pathlib import Path
from PIL import Image, ImageOps
import torch
from aiohttp import web
from server import PromptServer
import folder_paths

logger = logging.getLogger("Koharu-Bridge")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, *"
}

# Cache directories
BRIDGE_DIR = Path(__file__).parent.resolve()
BRIDGE_CACHE_DIR = BRIDGE_DIR / "cache"
BRIDGE_THUMB_DIR = BRIDGE_CACHE_DIR / "thumbnails"
try:
    BRIDGE_THUMB_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

# Check yet_essential custom_node thumbnails if present to share disk cache
CUSTOM_NODES_DIR = BRIDGE_DIR.parent
YE_THUMB_DIR = CUSTOM_NODES_DIR / "yet_essential" / "cache" / "thumbnails"

def json_response(data, status=200):
    return web.json_response(data, status=status, headers=CORS_HEADERS)

def get_filenames(category: str) -> list:
    try:
        return folder_paths.get_filename_list(category)
    except Exception:
        return []

def get_all_unets() -> list:
    unets = set()
    for cat in ["unet", "diffusion_models"]:
        for name in get_filenames(cat):
            unets.add(name)
    return sorted(list(unets))

def get_all_clips() -> list:
    clips = set()
    for cat in ["clip", "text_encoders"]:
        for name in get_filenames(cat):
            clips.add(name)
    return sorted(list(clips))

def get_samplers_list() -> list:
    try:
        import comfy.samplers
        return list(comfy.samplers.KSampler.SAMPLERS)
    except Exception:
        return []

def get_schedulers_list() -> list:
    try:
        import comfy.samplers
        return list(comfy.samplers.KSampler.SCHEDULERS)
    except Exception:
        return []

def get_gpu_info() -> list:
    devices = []
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(i)
            free_mem, total_mem = torch.cuda.mem_get_info(i)
            devices.append({
                "index": i,
                "name": props.name,
                "total_vram_mb": round(total_mem / (1024 * 1024), 2),
                "free_vram_mb": round(free_mem / (1024 * 1024), 2),
                "major": props.major,
                "minor": props.minor,
                "multi_processor_count": props.multi_processor_count
            })
    return devices

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
                ".preview.webp"
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
            if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
                img.save(bridge_thumb, "WEBP", quality=80, method=4)
            else:
                if img.mode != "RGB":
                    img = img.convert("RGB")
                img.save(bridge_thumb, "WEBP", quality=80, method=4)

        return str(bridge_thumb)
    except Exception as e:
        logger.warning(f"Failed to generate thumbnail for {orig_path}: {e}")
        return orig_path

routes = PromptServer.instance.routes

@routes.options("/koharu/{tail:.*}")
async def options_handler(request):
    return web.Response(headers=CORS_HEADERS)

@routes.get("/koharu/model_preview")
async def model_preview_handler(request):
    """
    Returns the thumbnail / preview image for a model.
    Params:
      - type: checkpoints | unet | loras | vae | clip
      - name: filename of the model
      - res: requested thumbnail size (default 300, or 0 / 'raw' for full image)
    """
    category = request.query.get("type", "checkpoints")
    name = request.query.get("name", "")
    res_param = request.query.get("res", "300")

    if not name:
        return web.Response(status=400, text="Missing model name parameter")

    preview_path = find_model_preview(category, name)
    if not preview_path or not os.path.exists(preview_path):
        return web.Response(status=404, text="Preview not found", headers=CORS_HEADERS)

    target_res = 300
    try:
        if res_param in ("0", "raw", "full", "none"):
            target_res = 0
        else:
            target_res = int(res_param)
    except Exception:
        target_res = 300

    if target_res > 0:
        serve_path = get_or_create_thumbnail(preview_path, target_res)
    else:
        serve_path = preview_path

    if serve_path and os.path.exists(serve_path):
        content_type = "image/webp" if serve_path.lower().endswith(".webp") else None
        headers = {
            "Cache-Control": "public, max-age=604800, immutable",
            **CORS_HEADERS
        }
        if content_type:
            headers["Content-Type"] = content_type
        return web.FileResponse(
            serve_path,
            headers=headers
        )
    return web.Response(status=404, text="Preview not found", headers=CORS_HEADERS)

@routes.get("/koharu/health")
async def health_handler(request):
    return json_response({
        "status": "ok",
        "bridge": "comfyui-koharu-bridge",
        "version": "1.0.0"
    })

@routes.get("/koharu/models")
async def models_handler(request):
    """
    Returns all models organized by category.
    """
    try:
        data = {
            "success": True,
            "checkpoints": get_filenames("checkpoints"),
            "unets": get_all_unets(),
            "loras": get_filenames("loras"),
            "vaes": get_filenames("vae"),
            "clips": get_all_clips(),
            "clip_vision": get_filenames("clip_vision"),
            "controlnet": get_filenames("controlnet"),
            "upscale_models": get_filenames("upscale_models"),
            "embeddings": get_filenames("embeddings"),
            "hypernetworks": get_filenames("hypernetworks"),
            "ipadapter": get_filenames("ipadapter"),
            "gligen": get_filenames("gligen"),
            "samplers": get_samplers_list(),
            "schedulers": get_schedulers_list()
        }
        return json_response(data)
    except Exception as e:
        logger.error(f"Error fetching models: {e}")
        return json_response({"success": False, "error": str(e)}, status=500)

@routes.post("/koharu/refresh")
async def refresh_handler(request):
    """
    Refreshes model folders cache so newly added files show up immediately.
    """
    try:
        return json_response({
            "success": True,
            "message": "Model lists refreshed",
            "checkpoints_count": len(get_filenames("checkpoints")),
            "unets_count": len(get_all_unets()),
            "loras_count": len(get_filenames("loras"))
        })
    except Exception as e:
        return json_response({"success": False, "error": str(e)}, status=500)

@routes.post("/koharu/shutdown")
async def shutdown_handler(request):
    if request.remote not in (None, "127.0.0.1", "::1"):
        return json_response({"success": False, "error": "Local requests only"}, status=403)

    asyncio.get_running_loop().call_later(0.25, signal.raise_signal, signal.SIGINT)
    return json_response({"success": True})

@routes.get("/koharu/system")
async def system_handler(request):
    """
    Returns hardware and PyTorch status.
    """
    try:
        return json_response({
            "success": True,
            "python_version": sys.version,
            "torch_version": torch.__version__,
            "cuda_available": torch.cuda.is_available(),
            "cuda_version": torch.version.cuda if torch.cuda.is_available() else None,
            "devices": get_gpu_info()
        })
    except Exception as e:
        return json_response({"success": False, "error": str(e)}, status=500)

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

print("\033[32m[Koharu Bridge]\033[0m Loaded successfully with thumbnail caching. API endpoints available at /koharu/models, /koharu/system")
