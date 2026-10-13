package main

import (
	"os"
	"path/filepath"
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/embedding"
)

func TestFreshInstallSelectsAndPersistsEmbeddingGemma(t *testing.T) {
	for _, key := range []string{config.KeyEmbedding, config.KeyEmbedModel, config.KeyIndexPath} {
		t.Setenv(key, "")
	}
	t.Setenv(config.KeyVector, "true")
	stdin, err := os.Open(os.DevNull)
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdin
	os.Stdin = stdin
	t.Cleanup(func() {
		os.Stdin = original
		stdin.Close()
	})

	home := t.TempDir()
	o := &config.Overrides{Home: home, ConfigFile: filepath.Join(home, "config")}
	c, err := config.Load(*o)
	if err != nil {
		t.Fatal(err)
	}
	if err := selectEmbedding(c, o); err != nil {
		t.Fatal(err)
	}
	if c.Embedding != embedding.Default() {
		t.Fatalf("first-run model = %q", c.Embedding)
	}

	reloaded, err := config.Load(config.Overrides{Home: home, ConfigFile: o.ConfigFile})
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Embedding != c.Embedding || reloaded.IndexPath != c.IndexPath {
		t.Fatal("first-run model and index must persist")
	}
}

func TestSavedModelChoicesAreRetained(t *testing.T) {
	for _, key := range []string{config.KeyEmbedding, config.KeyEmbedModel, config.KeyIndexPath} {
		t.Setenv(key, "")
	}

	for _, model := range []string{"jina-onnx", "qwen3-fp16-llama", "embeddinggemma-2"} {
		t.Run(model, func(t *testing.T) {
			home := t.TempDir()
			o := &config.Overrides{Home: home, ConfigFile: filepath.Join(home, "config")}
			if err := config.SetValues(o.ConfigFile, map[string]string{config.KeyEmbedding: model}); err != nil {
				t.Fatal(err)
			}
			c, err := config.Load(*o)
			if err != nil {
				t.Fatal(err)
			}

			index := c.IndexPath
			if err := selectEmbedding(c, o); err != nil {
				t.Fatal(err)
			}
			if c.Embedding != model || c.IndexPath != index {
				t.Fatal("saved model choice changed")
			}
		})
	}
}

func TestExistingJinaInstallKeepsItsModelAndIndex(t *testing.T) {
	for _, key := range []string{config.KeyEmbedding, config.KeyEmbedModel, config.KeyIndexPath} {
		t.Setenv(key, "")
	}

	home := t.TempDir()
	o := &config.Overrides{Home: home, ConfigFile: filepath.Join(home, "config")}
	c, err := config.Load(*o)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(c.EmbedModel), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(c.EmbedModel, []byte("legacy"), 0o644); err != nil {
		t.Fatal(err)
	}

	model, index := c.EmbedModel, c.IndexPath
	if err := selectEmbedding(c, o); err != nil {
		t.Fatal(err)
	}
	if c.Embedding != "" || c.EmbedModel != model || c.IndexPath != index {
		t.Fatal("existing Jina setup changed")
	}
}
