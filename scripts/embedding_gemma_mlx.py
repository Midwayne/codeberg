"""Text-only FP32 EmbeddingGemma 2 conversion and inference with MLX-VLM."""

import json
from pathlib import Path


def text_config(config: dict) -> dict:
    config["vision_config"] = None
    config["audio_config"] = None
    config["dtype"] = "float32"
    config["text_config"]["dtype"] = "float32"
    return config


def load_weights(model, source: Path, mx) -> None:
    index = source / "model.safetensors.index.json"
    if index.exists():
        mapping = json.loads(index.read_text())["weight_map"]
        files = [source / name for name in sorted(set(mapping.values()))]
    else:
        files = sorted(source.glob("*.safetensors"))
    if not files:
        raise ValueError("EmbeddingGemma MLX model weights are missing")

    weights = {}
    for path in files:
        weights.update(mx.load(str(path)))

    # The upstream sanitizer removes disabled audio/vision weights and maps
    # Hugging Face names to MLX. Cast only the remaining text parameters.
    weights = {name: value.astype(mx.float32)
               for name, value in model.sanitize(weights).items()}
    model.load_weights(list(weights.items()))
    mx.eval(model.parameters())


def prepare(repo: str, target: str) -> None:
    import mlx.core as mx
    from mlx.utils import tree_flatten
    from mlx_vlm.models.embedding_gemma2 import Model, ModelConfig
    from huggingface_hub import snapshot_download
    from transformers import AutoTokenizer

    source = Path(snapshot_download(repo_id=repo, allow_patterns=["*.json", "*.safetensors", "*.model"]))
    config = text_config(json.loads((source / "config.json").read_text()))
    model = Model(ModelConfig.from_dict(config))
    load_weights(model, source, mx)

    output = Path(target)
    output.mkdir(parents=True, exist_ok=True)
    mx.save_safetensors(str(output / "model.safetensors"), dict(tree_flatten(model.parameters())),
                        metadata={"format": "mlx"})
    (output / "config.json").write_text(json.dumps(config, indent=2) + "\n")
    tokenizer = AutoTokenizer.from_pretrained(source, local_files_only=True)
    tokenizer.save_pretrained(output)


def load_text_model(path: str):
    import mlx.core as mx
    from mlx_vlm.models.embedding_gemma2 import Model, ModelConfig
    from transformers import AutoTokenizer

    source = Path(path)
    config = json.loads((source / "config.json").read_text())
    if config.get("vision_config") is not None or config.get("audio_config") is not None:
        raise ValueError("EmbeddingGemma MLX requires a text-only model; rerun embedding setup")
    if config.get("dtype") != "float32" or "quantization" in config:
        raise ValueError("EmbeddingGemma MLX requires unquantized FP32 weights")

    model = Model(ModelConfig.from_dict(config))
    load_weights(model, source, mx)
    tokenizer = AutoTokenizer.from_pretrained(source, local_files_only=True)
    return model, tokenizer, mx


def embedder(path: str):
    model, tokenizer, mx = load_text_model(path)

    def embed(texts, query=False):
        prefix = "task: code retrieval | query: " if query else "title: none | text: "
        vectors = []
        for start in range(0, len(texts), 8):
            inputs = tokenizer([prefix + text for text in texts[start:start + 8]],
                               return_tensors="np", padding=True, truncation=True, max_length=8192)
            output = model(mx.array(inputs["input_ids"]),
                           attention_mask=mx.array(inputs["attention_mask"]))
            mx.eval(output.text_embeds)
            vectors.extend(output.text_embeds.astype(mx.float32).tolist())
        return vectors

    return embed, lambda: None
