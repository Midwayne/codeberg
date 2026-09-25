// Package embedding defines the launcher's selectable embedding models. The
// index namespace is part of a model's identity: embeddings from different
// models must never share a vector index, even when dimensions happen to match.
package embedding

import (
	"fmt"
	"path/filepath"
	"runtime"
)

const (
	Jina        = "jina-onnx"
	MLX         = "qwen3-mlx"
	Llama       = "qwen3-llama"
	MLX4B       = "qwen3-4b-mlx"
	Llama4B     = "qwen3-4b-llama"
	MLXFP16     = "qwen3-fp16-mlx"
	MLXBF16     = "qwen3-bf16-mlx"
	LlamaFP16   = "qwen3-fp16-llama"
	MLX4BFP16   = "qwen3-4b-fp16-mlx"
	MLX4BBF16   = "qwen3-4b-bf16-mlx"
	Llama4BFP16 = "qwen3-4b-fp16-llama"
)

type Model struct {
	ID, Label, Backend, HuggingFace, Filename string
}

var models = []Model{
	{Jina, "Jina v2 code (ONNX, 768d)", "onnx", "jinaai/jina-embeddings-v2-base-code", "model.onnx"},
	{MLXFP16, "Qwen3 0.6B (MLX FP16, Apple Silicon, ~1.2 GB) [default]", "mlx", "Qwen/Qwen3-Embedding-0.6B", "model.safetensors"},
	{MLXBF16, "Qwen3 0.6B (MLX BF16, Apple Silicon, ~1.2 GB)", "mlx", "Qwen/Qwen3-Embedding-0.6B", "model.safetensors"},
	{LlamaFP16, "Qwen3 0.6B (llama.cpp FP16, ~1.2 GB) [default]", "llama", "Qwen/Qwen3-Embedding-0.6B-GGUF", "Qwen3-Embedding-0.6B-f16.gguf"},
	{MLX, "Qwen3 0.6B (MLX 8-bit, ~640 MB)", "mlx", "mlx-community/Qwen3-Embedding-0.6B-8bit", "model.safetensors"},
	{Llama, "Qwen3 0.6B (llama.cpp Q8_0, ~640 MB)", "llama", "Qwen/Qwen3-Embedding-0.6B-GGUF", "Qwen3-Embedding-0.6B-Q8_0.gguf"},
	{MLX4BFP16, "Qwen3 4B (MLX FP16, Apple Silicon, ~8 GB)", "mlx", "Qwen/Qwen3-Embedding-4B", "model.safetensors"},
	{MLX4BBF16, "Qwen3 4B (MLX BF16, Apple Silicon, ~8 GB)", "mlx", "Qwen/Qwen3-Embedding-4B", "model.safetensors"},
	{Llama4BFP16, "Qwen3 4B (llama.cpp FP16, ~8 GB)", "llama", "Qwen/Qwen3-Embedding-4B-GGUF", "Qwen3-Embedding-4B-f16.gguf"},
	{MLX4B, "Qwen3 4B (MLX 8-bit, ~4.3 GB)", "mlx", "majentik/Qwen3-Embedding-4B-MLX-8bit", "model.safetensors"},
	{Llama4B, "Qwen3 4B (llama.cpp Q4_K_M, ~2.5 GB)", "llama", "Qwen/Qwen3-Embedding-4B-GGUF", "Qwen3-Embedding-4B-Q4_K_M.gguf"},
}

func List() []Model { return append([]Model(nil), models...) }

func Lookup(id string) (Model, error) {
	for _, m := range models {
		if m.ID == id {
			return m, nil
		}
	}
	return Model{}, fmt.Errorf("unknown embedding model %q (run `codeberg` to list available choices)", id)
}

func Default() string {
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		return MLXFP16
	}
	return LlamaFP16
}

func (m Model) Path(home string) string {
	if m.ID == Jina {
		return filepath.Join(home, "models", "jina-embeddings-v2-base-code", m.Filename)
	}
	return filepath.Join(home, "models", m.ID, m.Filename)
}

// IndexPath retains the existing Jina path for backward compatibility. Qwen
// variants have separate paths (and therefore separate chunk/graph sidecars).
func (m Model) IndexPath(home string) string {
	if m.ID == Jina {
		return filepath.Join(home, "index", "codeberg.usearch")
	}
	return filepath.Join(home, "index", m.ID, "codeberg.usearch")
}

func (m Model) ValidatePlatform() error {
	if m.Backend == "mlx" && (runtime.GOOS != "darwin" || runtime.GOARCH != "arm64") {
		return fmt.Errorf("%s requires Apple Silicon; choose a llama.cpp model instead", m.ID)
	}
	return nil
}
