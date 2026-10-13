"""Smoke-test the subprocess protocol without loading large model weights."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest import mock


def load_worker():
    spec = importlib.util.spec_from_file_location(
        "embedding_worker", Path(__file__).with_name("embedding_worker.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_protocol(module, backend, header, texts):
    request = struct.pack("=I", header)
    for text in texts:
        body = text.encode()
        request += struct.pack("=I", len(body)) + body

    output = io.BytesIO()
    stdout = io.TextIOWrapper(output, write_through=True)
    with mock.patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(request))):
        with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
            module.main(backend, "/unused")

    stdout.detach()
    return output.getvalue()


class EmbeddingWorkerTest(unittest.TestCase):
    def test_gemma_loads_text_only_in_safe_precision_and_uses_retrieval_prompts(self):
        module = load_worker()
        model = mock.Mock()
        model.encode.return_value.float.return_value.tolist.return_value = [[1.0, 0.0]]
        constructor = mock.Mock(return_value=model)
        torch = SimpleNamespace(float32="float32", bfloat16="bfloat16",
                                cuda=SimpleNamespace(is_available=lambda: False))

        for cuda in [False, True]:
            torch.cuda.is_available = lambda: cuda
            model.encode.reset_mock()

            with mock.patch.dict(sys.modules, {
                "torch": torch,
                "sentence_transformers": SimpleNamespace(SentenceTransformer=constructor),
            }):
                embed, stop = module.sentence_transformers_embedder("/local/model")
                self.assertEqual(embed(["code"]), [[1.0, 0.0]])
                embed(["question"], query=True)
                stop()

            self.assertEqual(constructor.call_args.kwargs["model_kwargs"]["torch_dtype"], "float32")
            self.assertEqual(constructor.call_args.kwargs["device"], "cuda" if cuda else "cpu")

        self.assertEqual(constructor.call_args.kwargs["config_kwargs"],
                         {"vision_config": None, "audio_config": None})
        self.assertEqual(constructor.call_args.kwargs["model_kwargs"]["torch_dtype"], "float32")
        self.assertEqual(model.max_seq_length, 8192)
        self.assertEqual(model.encode.call_args_list[0].kwargs["prompt_name"], "Document")
        self.assertEqual(model.encode.call_args_list[1].kwargs["prompt_name"], "CodeRetrieval")
        self.assertTrue(model.encode.call_args.kwargs["normalize_embeddings"])

    def test_gemma_protocol_distinguishes_single_document_from_query(self):
        module = load_worker()
        calls = []

        def fake_load(_path):
            def embed(texts, query=False):
                calls.append((texts, query))
                return [[1.0, 0.0] for _ in texts]

            return embed, lambda: None

        module.sentence_transformers_embedder = fake_load
        module.gemma_mlx_embedder = fake_load
        for backend in ["sentence-transformers", "gemma-mlx"]:
            for header, query in [(1, False), (0x80000001, True)]:
                calls.clear()
                output = run_protocol(module, backend, header, ["text"])
                self.assertEqual(output, b"READY 2\n" + struct.pack("=2f", 1, 0))
                self.assertEqual(calls[-1], (["text"], query))

    def test_non_finite_vectors_fail_before_ready(self):
        module = load_worker()
        module.mlx_embedder = lambda _: (lambda _: [[float("nan")]], lambda: None)

        with self.assertRaisesRegex(ValueError, "non-finite"):
            run_protocol(module, "mlx", 1, ["text"])

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
