"""Read ComfyUI model filenames without importing its server or custom nodes."""
import argparse
import json
import os
import sys


def discover(comfy_dir, launch_args):
    parser = argparse.ArgumentParser(add_help=False)
    for name in ("base", "models", "output"):
        parser.add_argument(f"--{name}-directory")
    parser.add_argument("--extra-model-paths-config", nargs="+", action="append", default=[])
    options, _ = parser.parse_known_args(launch_args)

    sys.path.insert(0, comfy_dir)
    from comfy.cli_args import args
    args.base_directory = options.base_directory
    args.models_directory = options.models_directory
    import folder_paths
    from utils.extra_config import load_extra_path_config

    default_config = os.path.join(comfy_dir, "extra_model_paths.yaml")
    if os.path.isfile(default_config):
        load_extra_path_config(default_config)
    for group in options.extra_model_paths_config:
        for config in group:
            load_extra_path_config(config)

    if options.output_directory:
        folder_paths.set_output_directory(os.path.abspath(options.output_directory))
    for category in ("checkpoints", "clip", "vae", "diffusion_models", "loras"):
        folder_paths.add_model_folder_path(category, os.path.join(folder_paths.get_output_directory(), category))

    categories = {
        "checkpoints": "checkpoints", "unets": "diffusion_models", "loras": "loras",
        "vaes": "vae", "embeddings": "embeddings", "controlnet": "controlnet",
        "upscale_models": "upscale_models", "hypernetworks": "hypernetworks",
    }
    return {key: folder_paths.get_filename_list(category) for key, category in categories.items()}


if __name__ == "__main__":
    print(json.dumps(discover(sys.argv[1], json.loads(sys.argv[2]))))
