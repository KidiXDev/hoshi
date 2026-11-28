import comfy.patcher_extension
import comfy.samplers
from comfy.ldm.moss_image.model import MOSSImage

from .mg_cache import MGCache, attach
from .mg_calibration import (
    NO_CALIBRATION,
    MGCalibration,
    calibration_path,
    list_calibrations,
    load_calibration,
)

CATEGORY = "koharu"
CALC_COND_BATCH_OPTION = "sampler_calc_cond_batch_function"
TEXT_EMBEDDER_WRAPPER_KEY = "koharu_text_embedder_cache"
TEXT_EMBEDDER_FORWARD = "diffusion_model.text_embedder.forward"


# Guidance interval
def default_calc_cond_batch(args):
    return comfy.samplers.calc_cond_batch(
        args["model"],
        args["conds"],
        args["input"],
        args["sigma"],
        args["model_options"],
    )


def guidance_interval(model, start_percent, end_percent):
    model = model.clone()
    model_sampling = model.get_model_object("model_sampling")
    sigma_start = model_sampling.percent_to_sigma(start_percent)
    sigma_end = model_sampling.percent_to_sigma(end_percent)
    calc_cond_batch = model.model_options.get(
        CALC_COND_BATCH_OPTION, default_calc_cond_batch
    )

    def interval_calc_cond_batch(args):
        cond, uncond = args["conds"]
        sigma = args["sigma"].max().item()
        if uncond is None or sigma_end <= sigma <= sigma_start:
            return calc_cond_batch(args)
        cond_prediction = calc_cond_batch({**args, "conds": [cond, None]})[0]
        return [cond_prediction, cond_prediction]

    model.set_model_sampler_calc_cond_batch_function(interval_calc_cond_batch)
    return model


# Text embedder cache
class TextEmbedCache:
    def __init__(self, embed):
        self.embed = embed
        self.entries = {}

    def outer_sample(self, executor, *args, **kwargs):
        self.entries.clear()
        try:
            return executor(*args, **kwargs)
        finally:
            self.entries.clear()

    def forward(self, x, pe, transformer_options, mask):
        uuids = transformer_options.get("uuids")
        if uuids is None:
            return self.embed(x, pe, transformer_options, mask)
        key = (tuple(uuids), tuple(x.shape))
        if key not in self.entries:
            self.entries[key] = self.embed(x, pe, transformer_options, mask)
        return self.entries[key]


def cache_text_embedder(model):
    model = model.clone()
    cache = TextEmbedCache(model.get_model_object(TEXT_EMBEDDER_FORWARD))
    model.add_object_patch(TEXT_EMBEDDER_FORWARD, cache.forward)
    model.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.OUTER_SAMPLE,
        TEXT_EMBEDDER_WRAPPER_KEY,
        cache.outer_sample,
    )
    return model


# Nodes
def budget_input(default):
    return ("FLOAT", {"default": default, "min": 0.0, "max": 10.0, "step": 0.01})


def percent_input(default):
    return ("FLOAT", {"default": default, "min": 0.0, "max": 1.0, "step": 0.01})


class KoharuMGCache:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "alpha": budget_input(0.05),
                "beta": budget_input(0.0),
                "calibration": ([NO_CALIBRATION, *list_calibrations()],),
                "forecast": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = CATEGORY

    def patch(self, model, alpha, beta, calibration, forecast):
        cache = MGCache(alpha, beta, load_calibration(calibration), forecast)
        return (attach(model, cache, beta > 0),)


class KoharuMGCacheCalibrate:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "name": ("STRING", {"default": "moss_image"}),
                "importance_stride": ("INT", {"default": 0, "min": 0, "max": 1000}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = CATEGORY

    def patch(self, model, name, importance_stride):
        calibration = MGCalibration(calibration_path(name), importance_stride)
        return (attach(model, calibration, importance_stride > 0),)


class KoharuGuidanceInterval:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "start_percent": percent_input(0.0),
                "end_percent": percent_input(0.5),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = CATEGORY

    def patch(self, model, start_percent, end_percent):
        return (guidance_interval(model, start_percent, end_percent),)


class KoharuMossTextEmbedderCache:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL",)}}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = CATEGORY

    def patch(self, model):
        if not isinstance(model.model.diffusion_model, MOSSImage):
            raise ValueError("The text embedder cache needs a MOSS Image model.")
        return (cache_text_embedder(model),)


NODE_CLASS_MAPPINGS = {
    "KoharuMGCache": KoharuMGCache,
    "KoharuMGCacheCalibrate": KoharuMGCacheCalibrate,
    "KoharuGuidanceInterval": KoharuGuidanceInterval,
    "KoharuMossTextEmbedderCache": KoharuMossTextEmbedderCache,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "KoharuMGCache": "Koharu MG-Cache",
    "KoharuMGCacheCalibrate": "Koharu MG-Cache Calibrate",
    "KoharuGuidanceInterval": "Koharu Guidance Interval",
    "KoharuMossTextEmbedderCache": "Koharu MOSS Text Embedder Cache",
}
