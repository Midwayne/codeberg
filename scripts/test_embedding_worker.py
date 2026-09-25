"""Smoke-test the subprocess protocol without loading large model weights."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import struct
import sys
import unittest


class EmbeddingWorkerTest(unittest.TestCase):
    def test_model_logs_cannot_corrupt_binary_response(self):
        spec = importlib.util.spec_from_file_location(
            "embedding_worker", Path(__file__).with_name("embedding_worker.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        def fake_load(_path):
            print("loading")
            def embed(texts):
                print("embedding")
                return [[float(len(text)), 1.0] for text in texts]
            return embed, lambda: None

        module.mlx_embedder = fake_load
        request = (struct.pack("=I", 2) + struct.pack("=I", 1) + b"a" +
                   struct.pack("=I", 2) + b"bb")
        output = io.BytesIO()
        stdout = io.TextIOWrapper(output, write_through=True)
        original_stdin = sys.stdin
        try:
            sys.stdin = io.TextIOWrapper(io.BytesIO(request))
            with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
                module.main("mlx", "/unused")
        finally:
            sys.stdin = original_stdin
            stdout.detach()
        self.assertEqual(output.getvalue(), b"READY 2\n" + struct.pack("=4f", 1, 1, 2, 1))


if __name__ == "__main__":
    unittest.main()
