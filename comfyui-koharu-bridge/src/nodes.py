import hashlib
import json
import os

import comfy.sample
import comfy.samplers
import comfy.utils
import folder_paths
import latent_preview
import numpy as np
import torch
from comfy.cli_args import args
from PIL import Image
from PIL.PngImagePlugin import PngInfo

MAX_SEED = 0xFFFFFFFFFFFFFFFF
CATEGORY = "koharu"


def slerp_noise(noise_a, noise_b, strength):
    t = min(max(float(strength), 0.0), 1.0)
    if t <= 0.0:
        return noise_a
    if t >= 1.0:
        return noise_b

    a = noise_a.reshape(noise_a.shape[0], -1)
    b = noise_b.reshape(noise_b.shape[0], -1)
    dot = torch.sum(
        torch.nn.functional.normalize(a, dim=1)
        * torch.nn.functional.normalize(b, dim=1),
        dim=1,
        keepdim=True,
    ).clamp(-0.9995, 0.9995)
    omega = torch.acos(dot)
    sin_omega = torch.sin(omega)
    interp = (torch.sin((1.0 - t) * omega) / sin_omega) * a + (
        torch.sin(t * omega) / sin_omega
    ) * b
    lerp = (1.0 - t) * a + t * b
    return torch.where(torch.abs(sin_omega) < 1e-6, lerp, interp).reshape_as(noise_a)


class KoharuKSampler:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "seed": ("INT", {"default": 0, "min": 0, "max": MAX_SEED}),
                "variation_seed": ("INT", {"default": 0, "min": 0, "max": MAX_SEED}),
                "variation_strength": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "cfg": (
                    "FLOAT",
                    {
                        "default": 8.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.1,
                        "round": 0.01,
                    },
                ),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS,),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "latent_image": ("LATENT",),
                "denoise": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
            }
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "sample"
    CATEGORY = CATEGORY

    def sample(
        self,
        model,
        seed,
        variation_seed,
        variation_strength,
        steps,
        cfg,
        sampler_name,
        scheduler,
        positive,
        negative,
        latent_image,
        denoise=1.0,
    ):
        latent = comfy.sample.fix_empty_latent_channels(
            model,
            latent_image["samples"],
            latent_image.get("downscale_ratio_spacial", None),
            latent_image.get("downscale_ratio_temporal", None),
        )
        batch_inds = latent_image.get("batch_index")
        noise = slerp_noise(
            comfy.sample.prepare_noise(latent, seed, batch_inds),
            comfy.sample.prepare_noise(latent, variation_seed, batch_inds),
            variation_strength,
        )
        samples = comfy.sample.sample(
            model,
            noise,
            steps,
            cfg,
            sampler_name,
            scheduler,
            positive,
            negative,
            latent,
            denoise=denoise,
            noise_mask=latent_image.get("noise_mask"),
            callback=latent_preview.prepare_callback(model, steps),
            disable_pbar=not comfy.utils.PROGRESS_BAR_ENABLED,
            seed=seed,
        )
        out = latent_image.copy()
        out.pop("downscale_ratio_spacial", None)
        out.pop("downscale_ratio_temporal", None)
        out["samples"] = samples
        return (out,)


class KoharuScaleToReference:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "reference": ("IMAGE",),
                "scale_by": (
                    "FLOAT",
                    {"default": 2.0, "min": 0.1, "max": 10.0, "step": 0.1},
                ),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "scale"
    CATEGORY = CATEGORY

    def scale(self, image, reference, scale_by):
        width = max(8, int(reference.shape[2] * scale_by) // 8 * 8)
        height = max(8, int(reference.shape[1] * scale_by) // 8 * 8)
        if image.shape[2] == width and image.shape[1] == height:
            return (image,)
        resized = comfy.utils.common_upscale(
            image.movedim(-1, 1), width, height, "lanczos", "disabled"
        ).movedim(1, -1)
        return (torch.clamp(resized, 0.0, 1.0),)


MODEL_HASH_CACHE = {}


def model_path(model_name):
    for folder_type in ("diffusion_models", "checkpoints"):
        try:
            path = folder_paths.get_full_path(folder_type, model_name)
        except Exception:
            path = None
        if path and os.path.isfile(path):
            return path
    return None


def model_hash(path):
    if not path:
        return ""
    stat = os.stat(path)
    cached = MODEL_HASH_CACHE.get(path)
    if cached and cached[0] == stat.st_mtime_ns and cached[1] == stat.st_size:
        return cached[2]
    digest = hashlib.sha256()
    with open(path, "rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    short_hash = digest.hexdigest()[:10]
    MODEL_HASH_CACHE[path] = (stat.st_mtime_ns, stat.st_size, short_hash)
    return short_hash


def format_field(value):
    return f"{value:g}" if isinstance(value, float) else str(value)


def a1111_parameters(positive, negative, fields, width, height):
    fields = {**fields, "Size": f"{width}x{height}"}
    parts = [positive.strip()] if positive.strip() else []
    if negative.strip():
        parts.append(f"Negative prompt: {negative.strip()}")
    parts.append(
        ", ".join(
            f"{key}: {format_field(value)}"
            for key, value in fields.items()
            if str(value).strip()
        )
    )
    return "\n".join(part for part in parts if part)


class KoharuSaveImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "ComfyUI"}),
                "positive": ("STRING", {"default": "", "multiline": True}),
                "negative": ("STRING", {"default": "", "multiline": True}),
                "seed": ("INT", {"default": 0, "min": 0, "max": MAX_SEED}),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "cfg": (
                    "FLOAT",
                    {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1},
                ),
                "sampler_name": ("STRING", {"default": ""}),
                "scheduler": ("STRING", {"default": ""}),
                "denoise": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
                "model_name": ("STRING", {"default": ""}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = CATEGORY

    def save(
        self,
        images,
        filename_prefix,
        positive,
        negative,
        seed,
        steps,
        cfg,
        sampler_name,
        scheduler,
        denoise,
        model_name,
        prompt=None,
        extra_pnginfo=None,
    ):
        fields = {
            "Steps": int(steps),
            "Sampler": sampler_name.strip(),
            "Schedule type": scheduler.strip(),
            "CFG scale": float(cfg),
            "Seed": int(seed),
        }
        if model_name.strip():
            fields["Model"] = model_name.strip()
            fields["Model hash"] = model_hash(model_path(model_name.strip()))
        if denoise > 0:
            fields["Denoising strength"] = float(denoise)

        full_output_folder, filename, counter, subfolder, _ = (
            folder_paths.get_save_image_path(
                filename_prefix,
                folder_paths.get_output_directory(),
                images[0].shape[1],
                images[0].shape[0],
            )
        )
        results = []
        for batch_number, image in enumerate(images):
            pixels = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
            metadata = None
            if not args.disable_metadata:
                metadata = PngInfo()
                metadata.add_text(
                    "parameters",
                    a1111_parameters(positive, negative, fields, img.width, img.height),
                )
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                for key, value in (extra_pnginfo or {}).items():
                    metadata.add_text(key, json.dumps(value))
            file = f"{filename.replace('%batch_num%', str(batch_number))}_{counter:05}_.png"
            img.save(
                os.path.join(full_output_folder, file),
                pnginfo=metadata,
                compress_level=4,
            )
            results.append({"filename": file, "subfolder": subfolder, "type": "output"})
            counter += 1
        return {"ui": {"images": results}}
