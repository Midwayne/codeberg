"""Use the production subprocess protocol to measure embedding round trips."""

import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time

import numpy as np


def exact(stream, size):
    output = bytearray()
    while len(output) < size:
        value = stream.read(size - len(output))
        if not value:
            raise RuntimeError("embedding worker ended before its response was complete")
        output.extend(value)
    return bytes(output)


class Worker:
    def __init__(self, backend, model, log):
        self.backend = backend
        self.log_path = Path(log)
        self.log = self.log_path.open("w")
        root = Path(__file__).resolve().parents[2]
        if backend == "jina-onnx":
            command = [sys.executable, str(root / "core/bench/retrieval_worker.py"), str(model)]
        else:
            command = [sys.executable, str(root / "scripts/embedding_worker.py"), backend, str(model)]
        if sys.platform == "darwin":
            command = ["/usr/bin/time", "-l", *command]
        started = time.perf_counter()
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.log, env=dict(os.environ, HF_HUB_OFFLINE="1"))
        ready = self.process.stdout.readline().decode().strip()
        if not ready.startswith("READY "):
            self.close()
            raise RuntimeError(f"worker failed to load: {ready}; see {log}")
        self.dimension = int(ready.split()[1])
        self.load_seconds = time.perf_counter() - started

    def embed(self, texts, query=False, instruct=False):
        if query and instruct:
            prefix = "Instruct: Given a code search query, retrieve relevant code snippets that answer the query\nQuery: "
            texts = [prefix + text for text in texts]
        header = len(texts)
        if query and self.backend in ("gemma-mlx", "sentence-transformers"):
            header |= 0x80000000
        request = bytearray(struct.pack("=I", header))
        for text in texts:
            body = text.encode()
            request.extend(struct.pack("=I", len(body)))
            request.extend(body)

        started = time.perf_counter()
        self.process.stdin.write(request)
        self.process.stdin.flush()
        raw = exact(self.process.stdout, len(texts) * self.dimension * 4)
        elapsed = time.perf_counter() - started
        vectors = np.frombuffer(raw, dtype=np.float32).reshape(len(texts), self.dimension).copy()
        if not np.isfinite(vectors).all():
            raise ValueError("non-finite benchmark vectors")
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        if not (norms > 0).all():
            raise ValueError("zero benchmark vector")
        return vectors / norms, elapsed

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        self.process.wait(timeout=60)
        self.log.close()
        content = self.log_path.read_text()
        match = re.search(r"(\d+)\s+maximum resident set size", content)
        return int(match[1]) if match else None


def batches(rows):
    # Match the indexer's 1024-row sort window, 96-row call cap and 32 KiB
    # budget, charging each body at most 1024 bytes.
    for start in range(0, len(rows), 1024):
        window = sorted(range(start, min(start + 1024, len(rows))), key=lambda i: len(rows[i]["body"].encode()))
        group, cost = [], 0
        for index in window:
            charge = min(len(rows[index]["body"].encode()), 1024)
            if group and (len(group) == 96 or cost + charge > 32768):
                yield group
                group, cost = [], 0
            group.append(index)
            cost += charge
        if group:
            yield group


def embed_corpus(worker, rows, progress=False):
    vectors = np.empty((len(rows), worker.dimension), dtype=np.float32)
    duration = 0
    done = 0
    for indices in batches(rows):
        output, elapsed = worker.embed([rows[index]["body"] for index in indices])
        vectors[indices] = output
        duration += elapsed
        done += len(indices)
        if progress:
            print(f"embedded {done}/{len(rows)} chunks", flush=True)
    return vectors, duration
