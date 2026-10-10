"""Run with ComfyUI's Python: local_model_discovery_check.py /path/to/ComfyUI."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    local = root / "models" / "loras"
    extra = root / "external models" / "nested"
    local.mkdir(parents=True)
    extra.mkdir(parents=True)
    (local / "local-check.safetensors").touch()
    (extra / "extra-check.safetensors").touch()
    (extra / "ignore.safetensors.part").touch()
    config = root / "paths.yaml"
    config.write_text('test:\n  base_path: "external models"\n  loras: |\n    nested\n', encoding="utf-8")
    script = Path(__file__).with_name("local_model_discovery.py").read_text(encoding="utf-8")
    result = subprocess.check_output([
        sys.executable, "-s", "-c", script, str(Path(sys.argv[1]).resolve()),
        json.dumps(["--base-directory", str(root), "--extra-model-paths-config", str(config)]),
    ], encoding="utf-8")
    models = json.loads(result)
    assert "local-check.safetensors" in models["loras"]
    assert "extra-check.safetensors" in models["loras"]
    assert "ignore.safetensors.part" not in models["loras"]
    assert set(models) == {"checkpoints", "unets", "loras", "vaes", "embeddings", "controlnet", "upscale_models", "hypernetworks"}
    (extra / "extra-check.safetensors").unlink()
    result = subprocess.check_output([
        sys.executable, "-s", "-c", script, str(Path(sys.argv[1]).resolve()),
        json.dumps(["--base-directory", str(root), "--extra-model-paths-config", str(config)]),
    ], encoding="utf-8")
    assert "extra-check.safetensors" not in json.loads(result)["loras"]
    print("Local discovery checks passed (local files, extra paths, partial files, deleted files).")
