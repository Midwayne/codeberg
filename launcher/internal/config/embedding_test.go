package config

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestEmbeddingGemmaWorkerEnvironmentAndIndex(t *testing.T) {
	home, dist := t.TempDir(), t.TempDir()
	writeArtifacts(t, dist)
	c, err := Load(Overrides{
		Home: home, Dist: dist, ConfigFile: filepath.Join(home, "config"),
		Embedding: "embeddinggemma-2", IndexPath: filepath.Join(home, "custom.usearch"),
	})
	if err != nil {
		t.Fatal(err)
	}

	env := c.DaemonEnv()
	for key, want := range map[string]string{
		KeyEmbedBackend:      "sentence-transformers",
		KeyEmbedModel:        filepath.Join(home, "models", "embeddinggemma-2"),
		KeyIndexPath:         filepath.Join(home, "custom.usearch.embeddinggemma-2"),
		"CBERG_EMBED_WORKER": filepath.Join(dist, "scripts", "embedding_worker.py"),
		"CBERG_EMBED_PYTHON": filepath.Join(home, "embeddinggemma-venv", "bin", "python"),
	} {
		if env[key] != want {
			t.Errorf("%s = %q, want %q", key, env[key], want)
		}
	}
}

func TestGemmaMLXWorkerEnvironment(t *testing.T) {
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" {
		t.Skip("Gemma MLX requires Apple Silicon")
	}

	home := t.TempDir()
	c, err := Load(Overrides{
		Home: home, ConfigFile: filepath.Join(home, "config"),
		Embedding: "embeddinggemma-2-fp32-mlx",
	})
	if err != nil {
		t.Fatal(err)
	}

	env := c.DaemonEnv()
	if env[KeyEmbedBackend] != "gemma-mlx" || env[KeyEmbedModel] != filepath.Dir(c.EmbedModel) {
		t.Fatalf("unexpected worker settings: %+v", env)
	}
	if env["CBERG_EMBED_PYTHON"] != filepath.Join(home, "embeddinggemma-mlx-venv", "bin", "python") {
		t.Fatal("MLX runtime not forwarded")
	}
}
