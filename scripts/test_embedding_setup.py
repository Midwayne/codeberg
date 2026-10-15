"""Tests for managed embedding model installation."""

import importlib
import importlib.util
from pathlib import Path
import shutil
import sys
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock


class EmbeddingSetupTest(unittest.TestCase):
    def test_gemma_setup_saves_text_only_fp32_with_8192_token_limit(self):
        spec = importlib.util.spec_from_file_location(
            "embedding_setup", Path(__file__).with_name("embedding_setup.py"))
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)

        model = mock.Mock()
        constructor = mock.Mock(return_value=model)
        modules = {
            "torch": SimpleNamespace(float32="float32"),
            "sentence_transformers": SimpleNamespace(SentenceTransformer=constructor),
        }

        with mock.patch.dict(sys.modules, modules):
            setup._prepare_gemma("google/embeddinggemma-2", "/local/model")

        self.assertEqual(model.max_seq_length, 8192)
        self.assertEqual(constructor.call_args.kwargs["config_kwargs"],
                         {"vision_config": None, "audio_config": None})
        self.assertEqual(constructor.call_args.kwargs["model_kwargs"]["torch_dtype"], "float32")
        model.save_pretrained.assert_called_once_with("/local/model")

    def test_gemma_setup_installs_supported_dependencies_and_saves_atomically(self):
        spec = importlib.util.spec_from_file_location(
            "embedding_setup", Path(__file__).with_name("embedding_setup.py"))
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        target = root / "model" / "modules.json"
        env = root / "venv"
        python = env / "bin" / "python"
        python.parent.mkdir(parents=True)
        python.touch()

        def run(args, **_kwargs):
            if args[1] == "-c":
                raise setup.subprocess.CalledProcessError(1, args)
            if "--prepare-gemma" in args:
                partial = Path(args[-1])
                self.assertEqual(partial.name, "model.part")
                (partial / "modules.json").write_text("[]")
                (partial / "tokenizer.json").write_text("{}")

        with mock.patch.object(setup.subprocess, "run", side_effect=run) as process:
            setup.main("embeddinggemma-2", "google/embeddinggemma-2", str(target), str(env))

        install = process.call_args_list[1].args[0]
        self.assertIn("sentence-transformers[image]==6.1.0", install)
        self.assertIn("transformers==5.19.0", install)
        self.assertTrue(target.exists())
        self.assertFalse((root / "model.part").exists())

    def test_failed_gemma_setup_preserves_previous_model(self):
        spec = importlib.util.spec_from_file_location(
            "embedding_setup", Path(__file__).with_name("embedding_setup.py"))
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        target = root / "model" / "modules.json"
        target.parent.mkdir()
        target.write_text("previous")
        python = root / "venv" / "bin" / "python"
        python.parent.mkdir(parents=True)
        python.touch()

        def run(args, **_kwargs):
            if "--prepare-gemma" in args:
                raise setup.subprocess.CalledProcessError(1, args)

        with mock.patch.object(setup.subprocess, "run", side_effect=run):
            with self.assertRaises(setup.subprocess.CalledProcessError):
                setup.main("embeddinggemma-2", "google/embeddinggemma-2",
                           str(target), str(root / "venv"))

        self.assertEqual(target.read_text(), "previous")
        self.assertFalse((root / "model.part").exists())

    def test_mlx_conversion_does_not_preserve_read_only_cache_mode(self):
        spec = importlib.util.spec_from_file_location(
            "embedding_setup", Path(__file__).with_name("embedding_setup.py"))
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        source = root / "cache" / "tokenizer.json"
        source.parent.mkdir()
        source.write_text("cached")
        source.chmod(0o444)
        destination = root / "model"
        destination.mkdir()

        converter = SimpleNamespace(shutil=shutil)

        def convert(**_kwargs):
            converter.shutil.copy(source, destination)
            (destination / source.name).write_text("saved")

        converter.convert = convert
        with mock.patch.object(importlib, "import_module", return_value=converter):
            setup._convert_mlx("repo", str(destination), "float16")

        self.assertEqual((destination / source.name).read_text(), "saved")


if __name__ == "__main__":
    unittest.main()
