import logging
import math

import comfy.model_management
import comfy.model_prefetch
import comfy.patcher_extension
import torch
from torch import nn

WRAPPER_KEY = "koharu_mg_cache"
BLOCK_TYPES = ("double_block", "single_block")
CACHED_STREAMS = ("img", "txt")
PROBE_STRIDE = 8


def relative_l1(reference, current):
    reference, current = reference.float(), current.float()
    return ((current - reference).abs().mean() / (current.abs().mean() + 1e-8)).item()


def branch_key(transformer_options):
    return tuple(transformer_options.get("cond_or_uncond", ()))


def current_sigma(transformer_options):
    return transformer_options["sigmas"].max().item()


def block_depth(model):
    block_lists = (
        child
        for child in model.model.diffusion_model.children()
        if isinstance(child, nn.ModuleList)
    )
    return max((len(blocks) for blocks in block_lists), default=0)


def attach(model, handler, replace_blocks=True):
    model = model.clone()
    model.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.OUTER_SAMPLE,
        WRAPPER_KEY,
        handler.outer_sample,
    )
    model.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
        WRAPPER_KEY,
        handler.diffusion_model,
    )
    if replace_blocks:
        for block_type in BLOCK_TYPES:
            for index in range(block_depth(model)):
                model.set_model_patch_replace(handler.block, "dit", block_type, index)
    return model


class LayerSlot:
    def __init__(self, probe, residual):
        self.probe = probe
        self.residual = residual
        self.risk = 0.0


class BranchState:
    def __init__(self):
        self.input = None
        self.input_drift = 0.0
        self.rate = None
        self.output = None
        self.output_step = None
        self.step = None
        self.anchor = None
        self.aligned = True
        self.ordinal = 0
        self.layers = {}
        self.history = []


class MGCache:
    def __init__(self, alpha, beta, calibration, forecast=False):
        self.alpha = alpha
        self.beta = beta
        self.calibration = calibration
        self.forecast = forecast
        self.states = {}
        self.counts = {"steps": 0, "skipped_steps": 0, "blocks": 0, "reused_blocks": 0}

    def outer_sample(self, executor, *args, **kwargs):
        self.states.clear()
        self.counts = dict.fromkeys(self.counts, 0)
        try:
            return executor(*args, **kwargs)
        finally:
            self.states.clear()
            logging.info(
                "MG-Cache: skipped %d/%d model calls, reused %d/%d blocks",
                self.counts["skipped_steps"],
                self.counts["steps"],
                self.counts["reused_blocks"],
                self.counts["blocks"],
            )

    # Timestep cache
    def timestep_risk(self, state, x, sigma):
        if self.calibration is None:
            if state.input is not None:
                state.input_drift += relative_l1(state.input, x)
            return math.inf if state.rate is None else state.rate * state.input_drift
        sigmas, drift = self.calibration["sigmas"], self.calibration["drift"]
        state.step = min(
            range(len(sigmas)), key=lambda index: abs(sigmas[index] - sigma)
        )
        state.aligned = state.aligned and abs(sigmas[state.step] - sigma) < 1e-4
        return (
            math.inf
            if state.anchor is None
            else drift[state.step] - drift[state.anchor]
        )

    def forecast_output(self, state, sigma):
        (previous_sigma, previous), (last_sigma, last) = state.history
        return torch.lerp(
            previous, last, (sigma - previous_sigma) / (last_sigma - previous_sigma)
        )

    def reuse_output(self, state, sigma):
        if (
            self.forecast
            and len(state.history) == 2
            and state.history[0][0] != state.history[1][0]
        ):
            return self.forecast_output(state, sigma)
        regression_applies = (
            self.calibration is not None
            and state.aligned
            and state.step == state.output_step + 1
            and self.calibration["k"][state.step] is not None
        )
        if regression_applies:
            shape = (1, -1) + (1,) * (state.output.ndim - 2)
            slope = self.calibration["k"][state.step].to(state.output).view(shape)
            intercept = self.calibration["b"][state.step].to(state.output).view(shape)
            state.output = state.output * slope + intercept
        state.output_step = state.step
        return state.output

    def diffusion_model(
        self, executor, x, timestep, context, transformer_options, **kwargs
    ):
        key = branch_key(transformer_options)
        state = self.states.get(key)
        if state is None or state.input.shape != x.shape:
            state = self.states[key] = BranchState()
        sigma = current_sigma(transformer_options)
        risk = self.timestep_risk(state, x, sigma)
        state.input = x
        self.counts["steps"] += 1
        if state.output is not None and risk <= self.alpha:
            self.counts["skipped_steps"] += 1
            return self.reuse_output(state, sigma)
        state.ordinal = 0
        output = executor(
            x, timestep, context, {**transformer_options, WRAPPER_KEY: state}, **kwargs
        )
        if (
            self.calibration is None
            and state.output is not None
            and state.input_drift > 0
        ):
            state.rate = relative_l1(state.output, output) / state.input_drift
        state.input_drift = 0.0
        state.anchor = state.output_step = state.step
        state.output = output
        state.history = [*state.history[-1:], (sigma, output)]
        return output

    # Layer cache
    def importance(self, state, layer):
        if self.calibration is None or self.calibration["phi"] is None:
            return 1.0
        scores = self.calibration["phi"][state.step]
        return scores[layer] if layer < len(scores) else 1.0

    def block(self, args, extra):
        state = args["transformer_options"][WRAPPER_KEY]
        layer = state.ordinal
        state.ordinal += 1
        self.counts["blocks"] += 1
        slot = state.layers.get(layer)
        with comfy.model_prefetch.pause_malloc_graph():
            probe = args["img"][:, ::PROBE_STRIDE, ::PROBE_STRIDE].to(
                torch.float32, copy=True
            )
            if slot is not None and slot.probe.shape == probe.shape:
                slot.risk += self.importance(state, layer) * relative_l1(
                    slot.probe, probe
                )
                slot.probe = probe
                if slot.risk < self.beta:
                    self.counts["reused_blocks"] += 1
                    return {
                        stream: args[stream] + residual.to(args[stream].device)
                        for stream, residual in slot.residual.items()
                    }
            before = {
                stream: args[stream].clone()
                for stream in CACHED_STREAMS
                if stream in args
            }
        out = extra["original_block"](args)
        cache_device = comfy.model_management.intermediate_device()
        with comfy.model_prefetch.pause_malloc_graph():
            residual = {
                stream: before[stream].sub_(out[stream]).neg_().to(cache_device)
                for stream in before
                if stream in out
            }
        del before
        state.layers[layer] = LayerSlot(probe, residual)
        return out
