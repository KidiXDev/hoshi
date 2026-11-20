import os
import sys
import tempfile

import torch

BRIDGE_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
sys.path[:0] = [sys.argv.pop(1), BRIDGE_DIR]

import comfy.model_base  # noqa: E402
import comfy.model_patcher  # noqa: E402
import comfy.patcher_extension  # noqa: E402
import comfy.sample  # noqa: E402
import comfy.samplers  # noqa: E402
import comfy.supported_models  # noqa: E402

from src import mg_calibration  # noqa: E402
from src.accelerators import cache_text_embedder, guidance_interval  # noqa: E402
from src.mg_cache import BranchState, MGCache, attach  # noqa: E402
from src.nodes import KoharuKSampler, ProgressiveResolutionSampler  # noqa: E402

STEPS = 10
CFG = 3.0
SEED = 7
LATENT_SIZE = (8, 6)
LOW_SIZE = (4, 3)
LAYERS = 4
UNET_CONFIG = {
    "image_model": "moss_image",
    "dim": 64,
    "ffn_dim": 128,
    "num_heads": 4,
    "num_layers": LAYERS,
    "text_dim": 32,
    "latent_channels": 8,
}
COUNTER_KEY = "test_counter"
DEVICE = torch.device("cpu")


def build_patcher():
    torch.manual_seed(0)
    model_config = comfy.supported_models.MOSSImage(UNET_CONFIG)
    model_config.set_inference_dtype(torch.float32, None)
    model = comfy.model_base.MOSSImage(model_config, device=DEVICE)
    for name, parameter in model.diffusion_model.named_parameters():
        if "norm" in name:
            torch.nn.init.ones_(parameter)
        else:
            torch.nn.init.normal_(parameter, std=0.1)
    return comfy.model_patcher.ModelPatcher(model, DEVICE, DEVICE)


def conditioning(tokens, seed):
    generator = torch.Generator().manual_seed(seed)
    return [[torch.randn(1, tokens, UNET_CONFIG["text_dim"], generator=generator), {}]]


def seeded_latent():
    generator = torch.Generator().manual_seed(SEED)
    return torch.randn(
        1, UNET_CONFIG["latent_channels"], *LATENT_SIZE, generator=generator
    )


class CallCounter:
    def __init__(self):
        self.batches = []
        self.sizes = []

    def diffusion_model(
        self, executor, x, timestep, context, transformer_options, **kwargs
    ):
        self.batches.append(list(transformer_options["cond_or_uncond"]))
        self.sizes.append(tuple(x.shape[-2:]))
        return executor(x, timestep, context, transformer_options, **kwargs)


def sample(patcher, sampler=None):
    patcher = patcher.clone()
    counter = CallCounter()
    patcher.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
        COUNTER_KEY,
        counter.diffusion_model,
    )
    guider = comfy.samplers.CFGGuider(patcher)
    guider.set_conds(conditioning(7, 1), conditioning(3, 2))
    guider.set_cfg(CFG)
    sigmas = comfy.samplers.calculate_sigmas(
        patcher.get_model_object("model_sampling"), "simple", STEPS
    )
    noise = seeded_latent()
    sampler = sampler or comfy.samplers.sampler_object("euler")
    samples = guider.sample(
        noise, torch.zeros_like(noise), sampler, sigmas, disable_pbar=True, seed=SEED
    )
    assert torch.isfinite(samples).all()
    return samples.float().cpu(), counter


def test_mg_cache_zero_budgets_are_lossless(patcher, reference):
    for forecast in (False, True):
        cached, _ = sample(attach(patcher, MGCache(0.0, 0.0, None, forecast)))
        assert torch.equal(reference, cached)


def test_mg_cache_budgets_skip_calls_and_blocks(patcher, reference):
    cache = MGCache(0.5, 0.5, None)
    cached, counter = sample(attach(patcher, cache))
    assert len(counter.batches) < 2 * STEPS
    assert cache.counts["reused_blocks"] > 0
    assert not cache.states
    assert not torch.equal(reference, cached)


def test_mg_cache_forecast_extrapolates_linearly():
    state = BranchState()
    first, second = torch.full((1, 2, 2, 2), 3.0), torch.full((1, 2, 2, 2), 2.0)
    state.history = [(1.0, first), (0.8, second)]
    state.output = second
    forecast = MGCache(1.0, 0.0, None, True).reuse_output(state, 0.6)
    assert torch.allclose(forecast, torch.full((1, 2, 2, 2), 1.0))
    assert torch.equal(MGCache(1.0, 0.0, None).reuse_output(state, 0.6), second)


def test_mg_calibration_round_trip(patcher, reference):
    with tempfile.TemporaryDirectory() as directory:
        mg_calibration.CALIBRATION_DIR = directory
        recorder = mg_calibration.MGCalibration(
            mg_calibration.calibration_path("tiny"), 5
        )
        calibrated, _ = sample(attach(patcher, recorder))
        assert torch.equal(reference, calibrated)
        assert mg_calibration.list_calibrations() == ["tiny.json"]
        calibration = mg_calibration.load_calibration("tiny.json")
        assert len(calibration["sigmas"]) == STEPS
        assert all(len(row) == LAYERS for row in calibration["phi"])
        lossless, _ = sample(attach(patcher, MGCache(-1.0, 0.0, calibration)))
        assert torch.equal(reference, lossless)
        budget = calibration["drift"][-1] / 4
        cached, _ = sample(attach(patcher, MGCache(budget, 0.3, calibration)))
        assert not torch.equal(reference, cached)
        for unsafe_name in ("../tiny.json", "missing.json"):
            try:
                mg_calibration.load_calibration(unsafe_name)
            except ValueError:
                continue
            raise AssertionError(f"accepted {unsafe_name}")
        try:
            mg_calibration.calibration_path("../escape")
        except ValueError:
            return
        raise AssertionError("path traversal accepted")


def test_text_embedder_cache_is_exact(patcher, reference):
    samples, _ = sample(cache_text_embedder(patcher))
    assert torch.equal(reference, samples)


def test_guidance_interval(patcher, reference):
    full, _ = sample(guidance_interval(patcher, 0.0, 1.0))
    assert torch.equal(reference, full)
    samples, counter = sample(guidance_interval(patcher, 0.0, 0.5))
    assert 0 < sum(1 in batch for batch in counter.batches) < STEPS
    assert sum(0 in batch for batch in counter.batches) == STEPS
    assert not torch.equal(reference, samples)


def test_progressive_resolution(patcher, reference):
    euler = comfy.samplers.sampler_object("euler")
    unchanged, _ = sample(patcher, ProgressiveResolutionSampler(euler, 0.5, 0.0))
    assert torch.equal(reference, unchanged)
    samples, counter = sample(patcher, ProgressiveResolutionSampler(euler, 0.5, 0.4))
    assert samples.shape == reference.shape
    assert counter.sizes.count(LOW_SIZE) == 2 * 4
    assert counter.sizes.count(LATENT_SIZE) == 2 * 6


def test_ksampler_node(patcher):
    latent = seeded_latent()
    positive, negative = conditioning(7, 1), conditioning(3, 2)

    def run(variation_strength, progressive_fraction):
        return KoharuKSampler().sample(
            patcher,
            SEED,
            SEED + 1,
            variation_strength,
            STEPS,
            CFG,
            "euler",
            "simple",
            positive,
            negative,
            {"samples": latent},
            0.6,
            0.5,
            progressive_fraction,
        )[0]["samples"]

    core = comfy.sample.sample(
        patcher,
        comfy.sample.prepare_noise(latent, SEED),
        STEPS,
        CFG,
        "euler",
        "simple",
        positive,
        negative,
        latent,
        denoise=0.6,
        disable_pbar=True,
        seed=SEED,
    )
    plain = run(0.0, 0.0)
    assert torch.equal(core, plain)
    assert not torch.equal(plain, run(0.5, 0.0))
    progressive = run(0.0, 0.4)
    assert progressive.shape == plain.shape
    assert torch.isfinite(progressive).all()
    assert not torch.equal(plain, progressive)


if __name__ == "__main__":
    patcher = build_patcher()
    reference, counter = sample(patcher)
    assert len(counter.batches) == 2 * STEPS
    test_mg_cache_zero_budgets_are_lossless(patcher, reference)
    test_mg_cache_budgets_skip_calls_and_blocks(patcher, reference)
    test_mg_cache_forecast_extrapolates_linearly()
    test_mg_calibration_round_trip(patcher, reference)
    test_text_embedder_cache_is_exact(patcher, reference)
    test_guidance_interval(patcher, reference)
    test_progressive_resolution(patcher, reference)
    test_ksampler_node(patcher)
    sys.stdout.write("ok\n")
