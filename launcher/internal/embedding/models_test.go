package embedding

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestEmbeddingGemmaIsDefaultAndIsolated(t *testing.T) {
	const id = "embeddinggemma-2"
	wantDefault := id
	if runtime.GOOS == "darwin" && runtime.GOARCH == "arm64" {
		wantDefault = "embeddinggemma-2-fp32-mlx"
	}
	if Default() != wantDefault {
		t.Fatalf("default = %q, want %q", Default(), wantDefault)
	}

	model, err := Lookup(id)
	if err != nil {
		t.Fatal(err)
	}
	if model.Backend != "sentence-transformers" || model.HuggingFace != "google/embeddinggemma-2" {
		t.Fatalf("unexpected model: %+v", model)
	}
	if err := model.ValidatePlatform(); err != nil {
		t.Fatal(err)
	}

	home := t.TempDir()
	for _, other := range List() {
		if other.ID == id {
			continue
		}
		if (strings.Contains(other.Label, "[default]") && other.ID != wantDefault) || other.IndexPath(home) == model.IndexPath(home) {
			t.Fatalf("conflicting choice: %+v", other)
		}
	}
}

func TestGemmaMLXHasSeparateModelRuntimeAndIndex(t *testing.T) {
	model, err := Lookup("embeddinggemma-2-fp32-mlx")
	if err != nil {
		t.Fatal(err)
	}
	if model.Backend != "gemma-mlx" || model.HuggingFace != "google/embeddinggemma-2" {
		t.Fatalf("unexpected MLX model: %+v", model)
	}

	home := t.TempDir()
	other, _ := Lookup(Gemma)
	qwen, _ := Lookup(MLXFP16)
	if model.Path(home) == other.Path(home) || model.IndexPath(home) == other.IndexPath(home) {
		t.Fatal("MLX must not reuse Sentence Transformers artifacts")
	}
	if model.VenvPath(home) == other.VenvPath(home) || model.VenvPath(home) == qwen.VenvPath(home) {
		t.Fatal("Gemma MLX must have its own runtime")
	}
	apple := runtime.GOOS == "darwin" && runtime.GOARCH == "arm64"
	if (model.ValidatePlatform() == nil) != apple {
		t.Fatal("Gemma MLX must require Apple Silicon")
	}
}

func TestIndexPathsPreserveLegacyAndSeparateModels(t *testing.T) {
	home := t.TempDir()
	jina, _ := Lookup(Jina)
	mlx, _ := Lookup(MLX)
	llama, _ := Lookup(Llama)
	mlx4, _ := Lookup(MLX4B)
	llama4, _ := Lookup(Llama4B)
	fp16, _ := Lookup(MLXFP16)
	bf16, _ := Lookup(MLXBF16)
	largeFP16, _ := Lookup(MLX4BFP16)
	if got, want := jina.IndexPath(home), filepath.Join(home, "index", "codeberg.usearch"); got != want {
		t.Fatalf("legacy path = %q, want %q", got, want)
	}
	if jina.IndexPath(home) == mlx.IndexPath(home) || mlx.IndexPath(home) == llama.IndexPath(home) ||
		mlx.IndexPath(home) == mlx4.IndexPath(home) || llama.IndexPath(home) == llama4.IndexPath(home) {
		t.Fatal("model choices must never share an index base")
	}
	if fp16.IndexPath(home) == bf16.IndexPath(home) || fp16.IndexPath(home) == largeFP16.IndexPath(home) ||
		fp16.IndexPath(home) == mlx.IndexPath(home) {
		t.Fatal("precision and model size must be part of the index identity")
	}
}
