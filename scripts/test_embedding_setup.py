"""Tests for managed embedding model installation."""

import importlib
import importlib.util
from pathlib import Path
import shutil
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock


class EmbeddingSetupTest(unittest.TestCase):
    def test_mlx_conversion_does_not_preserve_read_only_cache_mode(self):
        spec = importlib.util.spec_from_file_location(
            "embedding_setup", Path(__file__).with_name("embedding_setup.py"))
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)

        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
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
