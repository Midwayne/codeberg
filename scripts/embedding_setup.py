#!/usr/bin/env python3
"""Install a selected Qwen embedding model without touching other model files."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import venv

def main(model_id: str, repo: str, target: str, venv_path: str) -> None:
    backend = "mlx" if model_id.endswith("mlx") else "llama"
    if backend == "llama" and not shutil.which(os.environ.get("CBERG_LLAMA_SERVER", "llama-server")):
        raise RuntimeError("llama-server is required; install llama.cpp or set CBERG_LLAMA_SERVER before downloading")
    dest = Path(target)
    filename = dest.name
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
