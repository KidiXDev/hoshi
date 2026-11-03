import asyncio
import logging
import os
import signal
import sys
from urllib.parse import urlparse

import folder_paths
import torch
from aiohttp import web
from server import PromptServer

from .models import (
    get_all_clips,
    get_all_unets,
    get_filenames,
    get_samplers_list,
    get_schedulers_list,
)
from .previews import find_model_preview, get_or_create_thumbnail

logger = logging.getLogger("Koharu-Bridge")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, *",
}


def json_response(data, status=200):
    return web.json_response(data, status=status, headers=CORS_HEADERS)


def get_gpu_info() -> list:
    devices = []
    if torch.cuda.is_available():
        for i in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(i)
            free_mem, total_mem = torch.cuda.mem_get_info(i)
            devices.append(
                {
                    "index": i,
                    "name": props.name,
                    "total_vram_mb": round(total_mem / (1024 * 1024), 2),
                    "free_vram_mb": round(free_mem / (1024 * 1024), 2),
                    "major": props.major,
                    "minor": props.minor,
                    "multi_processor_count": props.multi_processor_count,
                }
            )
    return devices


routes = PromptServer.instance.routes


def allowed_app_origin():
    try:
        from comfy.cli_args import args

        origin = args.enable_cors_header
    except Exception:
        return None
    return origin if origin and origin != "*" else None


APP_ORIGIN = allowed_app_origin()


@web.middleware
async def koharu_origin_guard(request, handler):
    origin = request.headers.get("Origin")
    if (
        APP_ORIGIN
        and origin
        and origin != APP_ORIGIN
        and urlparse(origin).netloc != request.host
    ):
        return web.Response(status=403, text="Origin not allowed")
    return await handler(request)


try:
    PromptServer.instance.app.middlewares.append(koharu_origin_guard)
except Exception as error:
    logger.warning(f"Could not install origin guard: {error}")


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
        target_res = 0 if res_param in ("0", "raw", "full", "none") else int(res_param)
    except Exception:
        target_res = 300

    if target_res > 0:
        serve_path = get_or_create_thumbnail(preview_path, target_res)
    else:
        serve_path = preview_path

    if serve_path and os.path.exists(serve_path):
        content_type = "image/webp" if serve_path.lower().endswith(".webp") else None
        headers = {"Cache-Control": "public, max-age=604800, immutable", **CORS_HEADERS}
        if content_type:
            headers["Content-Type"] = content_type
        return web.FileResponse(serve_path, headers=headers)
    return web.Response(status=404, text="Preview not found", headers=CORS_HEADERS)


@routes.get("/koharu/health")
async def health_handler(request):
    return json_response(
        {"status": "ok", "bridge": "comfyui-koharu-bridge", "version": "1.0.0"}
    )


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
            "schedulers": get_schedulers_list(),
        }
        return json_response(data)
    except Exception as e:
        logger.error(f"Error fetching models: {e}")
        return json_response({"success": False, "error": str(e)}, status=500)


@routes.post("/koharu/refresh")
async def refresh_handler(request):
    try:
        getattr(folder_paths, "filename_list_cache", {}).clear()
        return json_response(
            {
                "success": True,
                "message": "Model lists refreshed",
                "checkpoints_count": len(get_filenames("checkpoints")),
                "unets_count": len(get_all_unets()),
                "loras_count": len(get_filenames("loras")),
            }
        )
    except Exception as e:
        return json_response({"success": False, "error": str(e)}, status=500)


@routes.post("/koharu/shutdown")
async def shutdown_handler(request):
    if request.remote not in (None, "127.0.0.1", "::1"):
        return json_response(
            {"success": False, "error": "Local requests only"}, status=403
        )

    asyncio.get_running_loop().call_later(0.25, signal.raise_signal, signal.SIGINT)
    return json_response({"success": True})


@routes.get("/koharu/system")
async def system_handler(request):
    """
    Returns hardware and PyTorch status.
    """
    try:
        return json_response(
            {
                "success": True,
                "python_version": sys.version,
                "torch_version": torch.__version__,
                "cuda_available": torch.cuda.is_available(),
                "cuda_version": torch.version.cuda
                if torch.cuda.is_available()
                else None,
                "devices": get_gpu_info(),
            }
        )
    except Exception as e:
        return json_response({"success": False, "error": str(e)}, status=500)
