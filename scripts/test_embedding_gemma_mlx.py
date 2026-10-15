"""Checks for the text-only FP32 MLX adapter without requiring Metal."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


def load_adapter():
    spec = importlib.util.spec_from_file_location(
        "embedding_gemma_mlx", Path(__file__).with_name("embedding_gemma_mlx.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GemmaMLXTest(unittest.TestCase):
    def test_conversion_disables_encoders_and_saves_only_fp32_text_weights(self):
        adapter = load_adapter()
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        source, target = root / "source", root / "output"
        source.mkdir()
        config = {"vision_config": {}, "audio_config": {}, "dtype": "bfloat16",
                  "text_config": {"dtype": "bfloat16"}, "model_type": "embedding_gemma2"}
        (source / "config.json").write_text(json.dumps(config))
        (source / "model.safetensors").touch()

        weight = mock.Mock()
        weight.astype.return_value = "fp32 weight"
        model = mock.Mock()
        model.sanitize.return_value = {"language_model.weight": weight}
        model.parameters.return_value = {"language_model.weight": "fp32 weight"}
        constructor = mock.Mock(return_value=model)
        mx = SimpleNamespace(float32="float32", load=mock.Mock(return_value={}),
                             eval=mock.Mock(), save_safetensors=mock.Mock())
        tokenizer = mock.Mock()
        download = mock.Mock(return_value=str(source))
        modules = {
            "mlx": SimpleNamespace(core=mx), "mlx.core": mx,
            "mlx.utils": SimpleNamespace(tree_flatten=lambda params: list(params.items())),
            "mlx_vlm.models.embedding_gemma2": SimpleNamespace(
                Model=constructor, ModelConfig=SimpleNamespace(from_dict=lambda cfg: cfg)),
            "huggingface_hub": SimpleNamespace(snapshot_download=download),
            "transformers": SimpleNamespace(AutoTokenizer=SimpleNamespace(
                from_pretrained=lambda *args, **kwargs: tokenizer)),
        }

        with mock.patch.dict(sys.modules, modules):
            adapter.prepare("google/embeddinggemma-2", str(target))

        actual_config = constructor.call_args.args[0]
        self.assertIsNone(actual_config["vision_config"])
        self.assertIsNone(actual_config["audio_config"])
        self.assertEqual(actual_config["dtype"], "float32")
        self.assertEqual(actual_config["text_config"]["dtype"], "float32")
        weight.astype.assert_called_once_with("float32")
        model.load_weights.assert_called_once_with([("language_model.weight", "fp32 weight")])
        self.assertEqual(mx.save_safetensors.call_args.args[1],
                         {"language_model.weight": "fp32 weight"})
        tokenizer.save_pretrained.assert_called_once_with(target)

        download.reset_mock()
        download.side_effect = AssertionError("local conversion must not contact the Hub")
        with mock.patch.dict(sys.modules, modules):
            adapter.prepare(str(source), str(root / "offline-output"))

        download.assert_not_called()

    def test_mlx_queries_and_documents_use_different_prompts_and_8192_token_limit(self):
        adapter = load_adapter()
        model, tokenizer, mx = mock.Mock(), mock.Mock(), mock.Mock()
        tokenizer.return_value = {"input_ids": [[1]], "attention_mask": [[1]]}
        mx.float32 = "float32"
        model.return_value.text_embeds.astype.return_value.tolist.return_value = [[1.0, 0.0]]

        with mock.patch.object(adapter, "load_text_model", return_value=(model, tokenizer, mx)):
            embed, stop = adapter.embedder("/local")
            self.assertEqual(embed(["function"]), [[1.0, 0.0]])
            embed(["question"], query=True)
            stop()

        self.assertEqual(tokenizer.call_args_list[0].args[0], ["title: none | text: function"])
        self.assertEqual(tokenizer.call_args_list[1].args[0], ["task: code retrieval | query: question"])
        for call in tokenizer.call_args_list:
            self.assertEqual(call.kwargs["max_length"], 8192)
        self.assertTrue(tokenizer.call_args.kwargs["truncation"])


if __name__ == "__main__":
    unittest.main()
