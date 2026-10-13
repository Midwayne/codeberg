"""Benchmark-only ONNX adapter matching Jina's existing C pooling/window."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import embedding_worker as protocol


def jina_embedder(path):
    import numpy as np
    import onnxruntime as ort
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(Path(path).parent, local_files_only=True)
    session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    names = {value.name for value in session.get_inputs()}

    def embed(texts):
        vectors = []
        for start in range(0, len(texts), 16):
            inputs = tokenizer(texts[start:start + 16], padding=True, truncation=True,
                               max_length=256, return_tensors="np")
            feed = {name: inputs[name].astype(np.int64) for name in names}
            output = session.run(None, feed)[0]
            if output.ndim == 3:
                mask = inputs["attention_mask"][..., None]
                output = (output * mask).sum(axis=1) / mask.sum(axis=1)
            output = output / np.linalg.norm(output, axis=1, keepdims=True)
            vectors.extend(output.astype(np.float32).tolist())
        return vectors

    return embed, lambda: None


if __name__ == "__main__":
    protocol.mlx_embedder = jina_embedder
    protocol.main("mlx", sys.argv[1])
