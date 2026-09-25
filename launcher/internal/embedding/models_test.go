package embedding

import (
	"path/filepath"
	"testing"
)

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
