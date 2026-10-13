#!/usr/bin/env python3
"""Persistent binary-protocol adapter for local embedding runtimes.

stdin: uint32 count, then repeated uint32 utf8 length + bytes;
stdout: READY <dimension> newline, then count * dimension native float32s.
All diagnostics go to stderr so the indexer's protocol stays unambiguous.
For EmbeddingGemma runtimes, count's high bit marks a query batch; the
remaining 31 bits are the count. Other runtimes retain their existing protocol.
"""

import json
import math
from contextlib import redirect_stdout
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request


def sentence_transformers_embedder(path: str):
    import torch
    from sentence_transformers import SentenceTransformer

    # Use FP32 on every device; FP16 produces NaNs for Gemma 2.
    cuda = torch.cuda.is_available()
    model = SentenceTransformer(
        path, device="cuda" if cuda else "cpu", local_files_only=True,
        config_kwargs={"vision_config": None, "audio_config": None},
        model_kwargs={"torch_dtype": torch.float32})
    model.max_seq_length = 8192

    def embed(texts, query=False):
        vectors = model.encode(
            texts, prompt_name="CodeRetrieval" if query else "Document",
            batch_size=8, normalize_embeddings=True, convert_to_tensor=True,
            show_progress_bar=False)
        return vectors.float().tolist()

    return embed, lambda: None


def gemma_mlx_embedder(path: str):
    from embedding_gemma_mlx import embedder

    return embedder(path)


def load_embedder(backend: str, path: str):
    if backend == "sentence-transformers":
        return sentence_transformers_embedder(path)
    if backend == "gemma-mlx":
        return gemma_mlx_embedder(path)
    if backend == "mlx":
        return mlx_embedder(path)
    if backend == "llama":
        return llama_embedder(path)
    raise ValueError(f"unknown embedding backend: {backend}")


def validate_vectors(vectors, count: int, dim: int) -> None:
    if len(vectors) != count or any(len(vector) != dim for vector in vectors):
        raise ValueError("embedding output shape changed")
    if any(not math.isfinite(value) for vector in vectors for value in vector):
        raise ValueError("non-finite embedding output")


def read_exact(n: int) -> bytes:
    data = bytearray()
    while len(data) < n:
        block = sys.stdin.buffer.read(n - len(data))
        if not block:
            raise EOFError("embedding worker input ended")
        data.extend(block)
    return bytes(data)


def mlx_embedder(path: str):
    import mlx.core as mx
    from mlx_embeddings.utils import load

    model, tokenizer = load(path)

    def embed(texts):
        vectors = []
        for start in range(0, len(texts), 8):
            tokens = tokenizer(texts[start:start + 8], return_tensors="np", padding=True,
                               truncation=True, max_length=512)
            output = model(mx.array(tokens["input_ids"]),
                           attention_mask=mx.array(tokens["attention_mask"]))
            mx.eval(output.text_embeds)
            vectors.extend(output.text_embeds.astype(mx.float32).tolist())
        return vectors

    return embed, lambda: None


def llama_embedder(path: str):
    # Let the worker own the server so stopping the indexer releases the model.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    binary = os.environ.get("CBERG_LLAMA_SERVER", "llama-server")
    process = subprocess.Popen([binary, "-m", path, "--embedding", "--pooling", "last",
                                "--host", "127.0.0.1", "--port", str(port)],
                               stdout=sys.stderr, stderr=sys.stderr)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(240):
            if process.poll() is not None:
                raise RuntimeError("llama-server exited before it was ready")
            try:
                with urllib.request.urlopen(base + "/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except (OSError, TimeoutError):
                time.sleep(0.5)
        else:
            raise RuntimeError("llama-server did not become ready")
    except BaseException:
        process.terminate()
        process.wait()
        raise

    def embed(texts):
        request = urllib.request.Request(base + "/v1/embeddings",
            data=json.dumps({"input": texts, "model": path}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=180) as response:
            data = json.load(response)["data"]
        return [item["embedding"] for item in sorted(data, key=lambda item: item["index"])]

    def stop():
        process.terminate()
        process.wait(timeout=5)

    return embed, stop


def main(backend: str, path: str):
    # Dependencies may print model-loading progress; stdout is reserved for the
    # binary protocol read by cberg-index.
    with redirect_stdout(sys.stderr):
        embed, stop = load_embedder(backend, path)
    try:
        # Detect model / endpoint errors before telling the indexer it is ready.
        with redirect_stdout(sys.stderr):
            first = embed(["code search"])
        dim = len(first[0])
        if not dim or dim > 16384:
            raise ValueError(f"invalid embedding dimension: {dim}")
        validate_vectors(first, 1, dim)
        sys.stdout.buffer.write(f"READY {dim}\n".encode())
        sys.stdout.buffer.flush()
        while header := sys.stdin.buffer.read(4):
            if len(header) != 4:
                raise EOFError("short batch header")
            count = struct.unpack("=I", header)[0]
            query = False
            if backend in ("sentence-transformers", "gemma-mlx"):
                query = bool(count & 0x80000000)
                count &= 0x7fffffff
            texts = [read_exact(struct.unpack("=I", read_exact(4))[0]).decode("utf-8")
                     for _ in range(count)]
            with redirect_stdout(sys.stderr):
                vectors = embed(texts, query=query) if backend in ("sentence-transformers", "gemma-mlx") else embed(texts)
            validate_vectors(vectors, count, dim)
            for vector in vectors:
                sys.stdout.buffer.write(struct.pack(f"={dim}f", *vector))
            sys.stdout.buffer.flush()
    finally:
        stop()


if __name__ == "__main__":
    try:
        main(*sys.argv[1:])
    except Exception as error:
        print(f"embedding worker: {error}", file=sys.stderr)
        sys.exit(1)
