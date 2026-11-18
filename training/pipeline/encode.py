"""Load a Sentence Transformers model the way Codeberg runs it, and embed text.

Codeberg embeds queries and code with different prompts (EmbeddingGemma 2:
"CodeRetrieval" and "Document"). Training, mining and evaluation must use the
same prompts, or the fine-tuned model is optimized for inputs it never sees.
"""

import hashlib
import json
from pathlib import Path

import numpy as np

QUERY_PROMPT_NAME = "CodeRetrieval"
DOCUMENT_PROMPT_NAME = "Document"


def device():
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_model(path, max_length):
    """FP32 on every device: FP16 produces NaNs for EmbeddingGemma 2."""
    import torch
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(str(path), device=device(),
                                config_kwargs={"vision_config": None, "audio_config": None},
                                model_kwargs={"torch_dtype": torch.float32})
    model.max_seq_length = max_length
    return model


def prompts(model):
    """(query prompt, document prompt); empty for models without named prompts."""
    return model.prompts.get(QUERY_PROMPT_NAME, ""), model.prompts.get(DOCUMENT_PROMPT_NAME, "")


def embed(model, texts, query, batch_size=8):
    query_prompt, document_prompt = prompts(model)
    vectors = model.encode(list(texts), prompt=query_prompt if query else document_prompt,
                           batch_size=batch_size, normalize_embeddings=True,
                           convert_to_numpy=True, show_progress_bar=len(texts) > 200)
    return np.asarray(vectors, dtype=np.float32)


def cached_embed(model, model_path, texts, query, cache_dir, max_length):
    """Embeddings cached by model, prompt side, length limit and exact texts."""
    key = hashlib.sha256(json.dumps([str(Path(model_path).resolve()), query, max_length, texts]).encode())
    path = Path(cache_dir) / f"{key.hexdigest()[:24]}.npy"
    if path.exists():
        return np.load(path)

    vectors = embed(model, texts, query)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, vectors)
    return vectors


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]


def write_jsonl(path, rows):
    with Path(path).open("w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
