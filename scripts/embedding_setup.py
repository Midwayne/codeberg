#!/usr/bin/env python3
"""Install a selected Qwen embedding model without touching other model files."""

import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv

MODELS_BY_ID = {
    "qwen3-mlx": ("mlx-community/Qwen3-Embedding-0.6B-8bit", "model.safetensors"),
    "qwen3-llama": ("Qwen/Qwen3-Embedding-0.6B-GGUF", "Qwen3-Embedding-0.6B-Q8_0.gguf"),
    "qwen3-4b-mlx": ("majentik/Qwen3-Embedding-4B-MLX-8bit", "model.safetensors"),
    "qwen3-4b-llama": ("Qwen/Qwen3-Embedding-4B-GGUF", "Qwen3-Embedding-4B-Q4_K_M.gguf"),
    "qwen3-fp16-mlx": ("Qwen/Qwen3-Embedding-0.6B", "model.safetensors"),
    "qwen3-bf16-mlx": ("Qwen/Qwen3-Embedding-0.6B", "model.safetensors"),
    "qwen3-fp16-llama": ("Qwen/Qwen3-Embedding-0.6B-GGUF", "Qwen3-Embedding-0.6B-f16.gguf"),
    "qwen3-4b-fp16-mlx": ("Qwen/Qwen3-Embedding-4B", "model.safetensors"),
    "qwen3-4b-bf16-mlx": ("Qwen/Qwen3-Embedding-4B", "model.safetensors"),
    "qwen3-4b-fp16-llama": ("Qwen/Qwen3-Embedding-4B-GGUF", "Qwen3-Embedding-4B-f16.gguf"),
}


def main(model_id: str, target: str, venv_path: str) -> None:
    repo, filename = MODELS_BY_ID[model_id]
    backend = "mlx" if model_id.endswith("mlx") else "llama"
    dest = Path(target)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if backend == "mlx":
        env = Path(venv_path)
        python = env / "bin" / "python"
        if not python.exists():
            venv.create(env, with_pip=True)
        try:
            subprocess.run([python, "-c", "import mlx_embeddings, huggingface_hub"], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.CalledProcessError:
            subprocess.run([python, "-m", "pip", "install", "mlx-embeddings==0.1.0"], check=True)
        if "fp16" in model_id or "bf16" in model_id:
            dtype = "bfloat16" if "bf16" in model_id else "float16"
            subprocess.run([python, "-m", "mlx_embeddings.convert", "--hf-path", repo,
                            "--mlx-path", str(dest.parent), "--dtype", dtype], check=True)
        else:
            # Hub caches the weights; local_dir belongs to this variant alone.
            subprocess.run([python, "-c",
                            "from huggingface_hub import snapshot_download; "
                            "import sys; snapshot_download(sys.argv[1], local_dir=sys.argv[2])",
                            repo, str(dest.parent)], check=True)
    else:
        url = f"https://huggingface.co/{repo}/resolve/main/{filename}"
        partial = dest.with_name(dest.name + ".part")
        try:
            with urllib.request.urlopen(url, timeout=60) as source, partial.open("wb") as output:
                while block := source.read(1024 * 1024):
                    output.write(block)
            os.replace(partial, dest)
        finally:
            partial.unlink(missing_ok=True)


if __name__ == "__main__":
    main(*sys.argv[1:])
