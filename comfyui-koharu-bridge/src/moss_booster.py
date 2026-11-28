import logging
import uuid

import comfy.ldm.modules.attention as attention
import comfy.model_management
import comfy.ops
import comfy.sd
import comfy.utils
import comfy_kitchen
from comfy.quant_ops import QuantizedTensor

CATEGORY = "koharu"
PREFIX = "diffusion_model."
MIN_INT8_TOKENS = 1024


# INT8 attention
def int8_attention_override(start_percent):
    last = {"sigmas": None, "int8": True}

    def step_allows_int8(options):
        sigmas, schedule = options.get("sigmas"), options.get("sample_sigmas")
        if start_percent <= 0 or sigmas is None or schedule is None:
            return True
        if sigmas is not last["sigmas"]:
            step = (schedule > sigmas.max() * 1.0001).sum().item()
            last["sigmas"] = sigmas
            last["int8"] = step >= start_percent * (len(schedule) - 1)
        return last["int8"]

    def override(func, q, k, v, *args, **kwargs):
        tokens = q.shape[2] if kwargs.get("skip_reshape") else q.shape[1]
        options = kwargs.get("transformer_options", {})
        if tokens < MIN_INT8_TOKENS or not step_allows_int8(options):
            return func(q, k, v, *args, **kwargs)
        return attention.attention_comfy_kitchen_int8(q, k, v, *args, **kwargs)

    return override


# LoRA baking
def merged_params(model, module_name, device, dtype):
    module = comfy.utils.get_attr(model.model, module_name)
    if not hasattr(module, "_v"):
        keys = (f"{module_name}.{param}" for param in ("weight", "bias"))
        return {
            key.rsplit(".", 1)[1]: model.patch_weight_to_device(
                key, device_to=device, return_weight=True
            )
            for key in keys
            if key in model.patches
        }, None
    weight, bias, stream = comfy.ops.cast_bias_weight(
        module,
        dtype=dtype,
        device=device,
        bias_dtype=dtype,
        offloadable=True,
        compute_dtype=dtype,
        want_requant=True,
    )
    return {"weight": weight, "bias": bias}, lambda: comfy.ops.uncast_bias_weight(
        module, weight, bias, stream
    )


def bake_patches(model):
    comfy.model_management.load_models_gpu([model])
    state_dict = model.model.diffusion_model.state_dict()
    device, dtype = model.load_device, model.model.get_dtype_inference()
    module_names = {
        key.rsplit(".", 1)[0] for key in model.patches if key.startswith(PREFIX)
    }

    for module_name in sorted(module_names):
        merged, release = merged_params(model, module_name, device, dtype)
        for param, tensor in merged.items():
            key = f"{module_name[len(PREFIX) :]}.{param}"
            if tensor is None or PREFIX + key not in model.patches:
                continue
            parts = (
                tensor.state_dict(key)
                if isinstance(tensor, QuantizedTensor)
                else {key: tensor}
            )
            for part_key, part in parts.items():
                if part_key in state_dict:
                    state_dict[part_key] = part.to("cpu", copy=True)
        if release is not None:
            release()

    init = getattr(model, "cached_patcher_init", None)
    is_diffusion_loader = init is not None and init[0] is comfy.sd.load_diffusion_model
    options = init[1][1] if is_diffusion_loader else {}
    baked = comfy.sd.load_diffusion_model_state_dict(state_dict, model_options=options)
    if baked is None:
        raise RuntimeError("MOSS Booster could not rebuild the baked model.")

    out = model.clone(model_override=baked.get_clone_model_override())
    out.patches = {}
    out.patches_uuid = uuid.uuid4()
    out.fast_disk = baked.fast_disk
    out.cached_patcher_init = None
    return out


# Nodes
class KoharuMossBooster:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "bake_lora": ("BOOLEAN", {"default": True}),
                "int8_attention": ("BOOLEAN", {"default": True}),
                "int8_start_percent": (
                    "FLOAT",
                    {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01},
                ),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = CATEGORY

    def patch(self, model, bake_lora, int8_attention, int8_start_percent):
        if bake_lora and model.patches and model.weight_wrapper_patches:
            logging.warning("MOSS Booster: weight wrappers present, LoRAs stay unbaked")
            model = model.clone()
        elif bake_lora and model.patches:
            model = bake_patches(model)
        else:
            model = model.clone()

        if not int8_attention:
            return (model,)
        device = comfy.model_management.get_torch_device()
        if not comfy_kitchen.int8_attention_is_available(device):
            logging.warning("MOSS Booster: INT8 attention unavailable on this GPU")
            return (model,)
        transformer_options = model.model_options["transformer_options"]
        transformer_options["optimized_attention_override"] = int8_attention_override(
            int8_start_percent
        )
        return (model,)


NODE_CLASS_MAPPINGS = {"KoharuMossBooster": KoharuMossBooster}
NODE_DISPLAY_NAME_MAPPINGS = {"KoharuMossBooster": "Koharu MOSS Booster"}
