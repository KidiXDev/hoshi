import json
import logging
import math
import os

import comfy.model_prefetch
import folder_paths
import torch

from .mg_cache import branch_key, current_sigma, relative_l1

CALIBRATION_DIR = os.path.join(folder_paths.get_user_directory(), "koharu", "mg_cache")
NO_CALIBRATION = "none"
PERTURBATION_STD = 0.1 * math.sqrt(math.pi / 2)


def fit_channels(previous, current):
    dims = [dim for dim in range(current.ndim) if dim != 1]
    previous, current = previous.float(), current.float()
    previous_mean = previous.mean(dims, keepdim=True)
    current_mean = current.mean(dims, keepdim=True)
    centered = previous - previous_mean
    slope = (centered * (current - current_mean)).mean(dims) / centered.square().mean(
        dims
    ).clamp_min(1e-8)
    intercept = current_mean.flatten() - slope * previous_mean.flatten()
    return slope.tolist(), intercept.tolist()


def column_mean(rows):
    return [sum(column) / len(column) for column in zip(*rows, strict=True)]


def list_calibrations():
    if not os.path.isdir(CALIBRATION_DIR):
        return []
    return sorted(
        name for name in os.listdir(CALIBRATION_DIR) if name.endswith(".json")
    )


def calibration_path(name):
    if not name or os.path.basename(name) != name:
        raise ValueError(f"Invalid MG-Cache calibration name: {name}")
    return os.path.join(CALIBRATION_DIR, name + ".json")


def load_calibration(name):
    if name == NO_CALIBRATION:
        return None
    if name not in list_calibrations():
        raise ValueError(f"MG-Cache calibration not found: {name}")
    with open(os.path.join(CALIBRATION_DIR, name), encoding="utf-8") as file:
        calibration = json.load(file)
    for field in ("k", "b"):
        calibration[field] = [
            None if row is None else torch.tensor(row) for row in calibration[field]
        ]
    return calibration


class MGCalibration:
    def __init__(self, path, importance_stride):
        self.path = path
        self.importance_stride = importance_stride
        self.reset()

    def reset(self):
        self.rows = {}
        self.outputs = {}
        self.calls = {}
        self.target = None
        self.ordinal = 0
        self.noise = None

    def outer_sample(self, executor, *args, **kwargs):
        self.reset()
        try:
            result = executor(*args, **kwargs)
            self.save()
            return result
        finally:
            self.reset()

    # Layer importance
    def block(self, args, extra):
        out = extra["original_block"](args)
        if self.ordinal == self.target:
            if self.noise is None:
                with comfy.model_prefetch.pause_malloc_graph():
                    hidden = out["img"]
                    generator = torch.Generator(device=hidden.device).manual_seed(0)
                    noise = torch.randn(
                        hidden.shape, generator=generator, device=hidden.device
                    )
                    self.noise = noise.mul_(PERTURBATION_STD).to(hidden.dtype)
            out["img"].add_(self.noise)
        self.ordinal += 1
        return out

    def layer_importance(self, forward, output, layers):
        scores = []
        for layer in range(layers):
            self.target, self.ordinal = layer, 0
            scores.append((forward().float() - output.float()).abs().mean().item())
        self.target = self.noise = None
        return scores

    # Recording
    def diffusion_model(
        self, executor, x, timestep, context, transformer_options, **kwargs
    ):
        def forward():
            return executor(x, timestep, context, transformer_options, **kwargs)

        self.ordinal = 0
        output = forward()
        layers = self.ordinal
        key = branch_key(transformer_options)
        sigma = round(current_sigma(transformer_options), 6)
        row = self.rows.setdefault(sigma, {"drift": [], "k": [], "b": [], "phi": []})
        previous = self.outputs.get(key)
        if previous is not None and previous.shape == output.shape:
            slope, intercept = fit_channels(previous, output)
            row["drift"].append(relative_l1(previous, output))
            row["k"].append(slope)
            row["b"].append(intercept)
        self.outputs[key] = output
        call = self.calls.get(key, 0)
        self.calls[key] = call + 1
        if self.importance_stride > 0 and call % self.importance_stride == 0:
            row["phi"].append(self.layer_importance(forward, output, layers))
        return output

    def save(self):
        sigmas = sorted(self.rows, reverse=True)
        drift, slopes, intercepts, importance = [], [], [], []
        accumulated, scores = 0.0, None
        for sigma in sigmas:
            row = self.rows[sigma]
            if row["drift"]:
                accumulated += sum(row["drift"]) / len(row["drift"])
            if row["phi"]:
                scores = column_mean(row["phi"])
            drift.append(accumulated)
            slopes.append(column_mean(row["k"]) if row["k"] else None)
            intercepts.append(column_mean(row["b"]) if row["b"] else None)
            importance.append(scores)
        if scores is None:
            importance = None
        else:
            mean_score = sum(sum(step) for step in importance) / sum(
                len(step) for step in importance
            )
            importance = [[score / mean_score for score in step] for step in importance]
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as file:
            json.dump(
                {
                    "sigmas": sigmas,
                    "drift": drift,
                    "phi": importance,
                    "k": slopes,
                    "b": intercepts,
                },
                file,
            )
        logging.info("MG-Cache: saved calibration to %s", self.path)
