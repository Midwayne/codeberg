#!/usr/bin/env sh
# Downloads jina-embeddings-v2-base-code (768-dim) into models/.
# Default variant is int8-quantized ONNX (~160MB). Set CBERG_MODEL_VARIANT=model
# for fp32 (~640MB) or model_fp16 for fp16.
#
# Usage: scripts/fetch-model.sh [dest_dir]
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dest="${1:-$repo_root/models/jina-embeddings-v2-base-code}"
variant="${CBERG_MODEL_VARIANT:-model_quantized}"
base="https://huggingface.co/jinaai/jina-embeddings-v2-base-code/resolve/main"

mkdir -p "$dest"
echo "Fetching jina-embeddings-v2-base-code ($variant) into $dest ..."
curl -fSL "$base/onnx/$variant.onnx" -o "$dest/model.onnx"
curl -fSL "$base/tokenizer.json" -o "$dest/tokenizer.json"
curl -fSL "$base/tokenizer_config.json" -o "$dest/tokenizer_config.json"
curl -fSL "$base/special_tokens_map.json" -o "$dest/special_tokens_map.json"
curl -fSL "$base/vocab.json" -o "$dest/vocab.json"

sed 's/"tokenizer_class"[[:space:]]*:[[:space:]]*"[^"]*"/"tokenizer_class": ""/' \
  "$dest/tokenizer_config.json" > "$dest/tokenizer_config.json.tmp"
mv "$dest/tokenizer_config.json.tmp" "$dest/tokenizer_config.json"

echo "Done. Set CBERG_TEST_MODEL=$dest/model.onnx to run embedding tests."
