package config

import "testing"

func TestDisabledVectorsIgnoreInheritedModel(t *testing.T) {
	t.Setenv("CODEBERG_VECTOR", "false")
	t.Setenv(EnvModel, "/missing/model.onnx")
	t.Setenv(EnvEmbedBackend, "mlx")
	t.Setenv(EnvEmbedWorker, "/missing/worker.py")
	t.Setenv(EnvEmbedPython, "/missing/python")
	t.Setenv(EnvLlamaServer, "/missing/llama-server")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Model != "" || cfg.EmbedBackend != "" || cfg.EmbedWorker != "" || cfg.EmbedPython != "" || cfg.LlamaServer != "" {
		t.Fatalf("disabled vectors retained embedding configuration: %#v", cfg.Indexer)
	}
}
