import math

import torch
import torch.nn.functional as F


def luma(image):
    weights = torch.tensor(
        [0.2126, 0.7152, 0.0722], device=image.device, dtype=image.dtype
    )
    return (image[..., :3] * weights).sum(dim=-1, keepdim=True)


def with_rgb(image, rgb):
    return torch.cat([rgb, image[..., 3:]], dim=-1) if image.shape[-1] > 3 else rgb


def gaussian_blur(image, sigma):
    if sigma <= 0.0:
        return image
    sigma = max(float(sigma), 1e-3)
    radius = max(1, int(round(sigma * 3.0)))
    x = torch.arange(-radius, radius + 1, device=image.device, dtype=image.dtype)
    kernel = torch.exp(-(x * x) / (2.0 * sigma * sigma))
    kernel = kernel / kernel.sum()
    channels = image.shape[-1]
    size = kernel.shape[0]
    pad = size // 2
    out = image.permute(0, 3, 1, 2)
    out = F.pad(out, (pad, pad, 0, 0), mode="reflect")
    out = F.conv2d(
        out, kernel.view(1, 1, 1, size).repeat(channels, 1, 1, 1), groups=channels
    )
    out = F.pad(out, (0, 0, pad, pad), mode="reflect")
    out = F.conv2d(
        out, kernel.view(1, 1, size, 1).repeat(channels, 1, 1, 1), groups=channels
    )
    return out.permute(0, 2, 3, 1)


def shift_channel(channel, shift_x, shift_y):
    if shift_x == 0 and shift_y == 0:
        return channel
    _, height, width = channel.shape
    pad_l, pad_r = max(shift_x, 0), max(-shift_x, 0)
    pad_t, pad_b = max(shift_y, 0), max(-shift_y, 0)
    out = F.pad(channel.unsqueeze(1), (pad_l, pad_r, pad_t, pad_b), mode="replicate")
    return out[:, :, pad_b : pad_b + height, pad_r : pad_r + width].squeeze(1)


def apply_style(
    image,
    vignette_strength,
    vignette_softness,
    film_grain,
    grain_seed,
    chromatic_aberration,
    ca_angle,
    bloom_strength,
    bloom_radius,
    bloom_threshold,
):
    x = image
    batch, height, width, channels = x.shape
    if vignette_strength > 0.0:
        yy = torch.linspace(-1.0, 1.0, height, device=x.device, dtype=x.dtype).view(
            height, 1
        )
        xx = torch.linspace(-1.0, 1.0, width, device=x.device, dtype=x.dtype).view(
            1, width
        )
        radius = torch.sqrt(xx * xx + yy * yy) / math.sqrt(2.0)
        power = 0.5 + (1.0 - vignette_softness) * 2.5
        vignette = 1.0 - vignette_strength * torch.pow(
            torch.clamp(radius, 0.0, 1.0), power
        )
        x = x * torch.clamp(vignette, 0.0, 1.0).view(1, height, width, 1)
    if film_grain > 0.0:
        generator = torch.Generator(device="cpu").manual_seed(
            int(grain_seed) & 0x7FFFFFFF
        )
        noise = torch.randn(
            (batch, height, width, 1), generator=generator, dtype=x.dtype
        )
        x = x + noise.to(x.device) * (0.12 * film_grain)
    if chromatic_aberration > 0.0 and channels >= 3:
        radians = math.radians(ca_angle)
        shift_x = int(round(chromatic_aberration * math.cos(radians)))
        shift_y = int(round(chromatic_aberration * math.sin(radians)))
        rgb = torch.stack(
            [
                shift_channel(x[..., 0], shift_x, shift_y),
                x[..., 1],
                shift_channel(x[..., 2], -shift_x, -shift_y),
            ],
            dim=-1,
        )
        x = with_rgb(x, rgb)
    if bloom_strength > 0.0 and bloom_radius > 0.0:
        threshold = min(max(bloom_threshold, 0.0), 1.0)
        highlights = torch.clamp(
            (luma(x) - threshold) / max(1e-5, 1.0 - threshold), 0.0, 1.0
        )
        glow = gaussian_blur(x[..., :3] * highlights, bloom_radius)
        x = with_rgb(x, x[..., :3] + glow * bloom_strength)
    return torch.clamp(x, 0.0, 1.0)


def apply_adjust(image, brightness, contrast, saturation, sharpness):
    x = image
    if brightness != 0.0:
        x = x + brightness
    if contrast != 1.0:
        x = (x - 0.5) * contrast + 0.5
    if saturation != 1.0 and x.shape[-1] >= 3:
        base = luma(x)
        x = with_rgb(x, base + (x[..., :3] - base) * saturation)
    if sharpness > 0.0:
        x = x + sharpness * (x - gaussian_blur(x, 0.8))
    return torch.clamp(x, 0.0, 1.0)


def float_input(default, minimum, maximum, step=0.01):
    return ("FLOAT", {"default": default, "min": minimum, "max": maximum, "step": step})


class KoharuPostFX:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "style_enabled": ("BOOLEAN", {"default": True}),
                "vignette_strength": float_input(0.0, 0.0, 1.0),
                "vignette_softness": float_input(0.5, 0.0, 1.0),
                "film_grain": float_input(0.0, 0.0, 1.0),
                "grain_seed": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF}),
                "chromatic_aberration": float_input(0.0, 0.0, 8.0, 0.1),
                "ca_angle": float_input(0.0, -180.0, 180.0, 1.0),
                "bloom_strength": float_input(0.0, 0.0, 2.0),
                "bloom_radius": float_input(1.5, 0.0, 12.0, 0.1),
                "bloom_threshold": float_input(0.7, 0.0, 1.0),
                "adjust_enabled": ("BOOLEAN", {"default": True}),
                "brightness": float_input(0.0, -1.0, 1.0),
                "contrast": float_input(1.0, 0.0, 3.0),
                "saturation": float_input(1.0, 0.0, 3.0),
                "sharpness": float_input(0.0, 0.0, 3.0),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"
    CATEGORY = "koharu"

    def apply(
        self,
        image,
        style_enabled,
        vignette_strength,
        vignette_softness,
        film_grain,
        grain_seed,
        chromatic_aberration,
        ca_angle,
        bloom_strength,
        bloom_radius,
        bloom_threshold,
        adjust_enabled,
        brightness,
        contrast,
        saturation,
        sharpness,
    ):
        x = image
        if style_enabled:
            x = apply_style(
                x,
                vignette_strength,
                vignette_softness,
                film_grain,
                grain_seed,
                chromatic_aberration,
                ca_angle,
                bloom_strength,
                bloom_radius,
                bloom_threshold,
            )
        if adjust_enabled:
            x = apply_adjust(x, brightness, contrast, saturation, sharpness)
        return (torch.clamp(x, 0.0, 1.0),)
