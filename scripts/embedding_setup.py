#!/usr/bin/env python3
"""Install a selected embedding model without touching other model files."""

import importlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
from types import SimpleNamespace
import urllib.request
import venv


def _prepare_gemma(repo: str, target: str) -> None:
    import torch
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(
        repo, device="cpu", config_kwargs={"vision_config": None, "audio_config": None},
        model_kwargs={"torch_dtype": torch.float32})
    model.max_seq_length = 8192
    model.save_pretrained(target)


def _setup_gemma(repo: str, dest: Path, venv_path: str, mlx: bool = False) -> None:
    env = Path(venv_path)
    python = env / "bin" / "python"
    if not python.exists():
        venv.create(env, with_pip=True)

    # Imports alone do not ensure that an older environment supports Gemma 2.
    check = (
        "from importlib.metadata import version; "
        "import torch; from transformers import EmbeddingGemma2Model, EmbeddingGemma2Processor; "
        "from sentence_transformers import SentenceTransformer; "
        "assert version('sentence-transformers') == '6.1.0'; "
        "assert version('transformers') == '5.19.0'"
    )
    packages = ["sentence-transformers[image]==6.1.0", "transformers==5.19.0"]
    if mlx:
        check = (
            "from importlib.metadata import version; "
            "from mlx_vlm.models.embedding_gemma2 import Model; "
            "from transformers import AutoTokenizer; "
            "assert version('mlx-vlm') == '0.7.8'; "
            "assert version('transformers') == '5.19.0'"
        )
        packages = ["mlx-vlm==0.7.8", "transformers==5.19.0"]
    try:
        subprocess.run([python, "-c", check], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        # The runtime packages include upstream processing dependencies even
        # though both adapters disable the model's audio/vision encoders.
        subprocess.run([python, "-m", "pip", "install", *packages], check=True)

    output = dest.parent
    partial = output.with_name(output.name + ".part")
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir(parents=True)
    try:
        mode = "--prepare-gemma-mlx" if mlx else "--prepare-gemma"
        subprocess.run([python, __file__, mode, repo, str(partial)], check=True)
        if not (partial / dest.name).is_file() or not (partial / "tokenizer.json").is_file():
            raise RuntimeError("EmbeddingGemma setup did not save a complete model")
        shutil.rmtree(output, ignore_errors=True)
        os.replace(partial, output)
    finally:
        shutil.rmtree(partial, ignore_errors=True)


def _convert_mlx(repo: str, target: str, dtype: str) -> None:
    converter = importlib.import_module("mlx_embeddings.convert")
    # Hugging Face cache files are read-only. mlx-embeddings preserves that mode
    # and then fails when it rewrites tokenizer.json and config.json.
    def copy_writable(source, destination):
        destination = Path(destination)
        if destination.is_dir():
            destination /= Path(source).name
        return shutil.copyfile(source, destination)

    converter.shutil = SimpleNamespace(copy=copy_writable)
    converter.convert(hf_path=repo, mlx_path=target, dtype=dtype)


def main(model_id: str, repo: str, target: str, venv_path: str) -> None:
    if model_id in ("embeddinggemma-2", "embeddinggemma-2-fp32-mlx"):
        if sys.version_info < (3, 10):
            raise RuntimeError("EmbeddingGemma 2 requires Python 3.10 or newer")
        _setup_gemma(repo, Path(target), venv_path, mlx=model_id.endswith("mlx"))
        return

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
            output = dest.parent
            partial = output.with_name(output.name + ".part")
            shutil.rmtree(partial, ignore_errors=True)
            partial.mkdir(parents=True)
            try:
                subprocess.run([python, __file__, "--convert-mlx", repo, str(partial), dtype],
                               check=True)
            except BaseException:
                shutil.rmtree(partial, ignore_errors=True)
                raise
            shutil.rmtree(output)
            os.replace(partial, output)
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
    if len(sys.argv) > 1 and sys.argv[1] == "--convert-mlx":
        _convert_mlx(*sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "--prepare-gemma":
        _prepare_gemma(*sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == "--prepare-gemma-mlx":
        from embedding_gemma_mlx import prepare

        prepare(*sys.argv[2:])
    else:
        main(*sys.argv[1:])
