package config

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDaemonRuntimeSettings(t *testing.T) {
	home := t.TempDir()
	t.Setenv(EnvRoots, "")
	t.Setenv(EnvHome, home)
	t.Setenv(EnvLogDir, filepath.Join(home, "logs"))
	t.Setenv(EnvHealthTimeout, "30m")
	t.Setenv(EnvNoIndex, "true")
	t.Setenv(EnvRootPID, "42")
	t.Setenv(EnvIndexNamespace, "qwen3-mlx")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Home != home || cfg.LogDir != filepath.Join(home, "logs") || cfg.RootPID != 42 {
		t.Fatalf("runtime paths: %#v", cfg)
	}

	if cfg.HealthTimeout != 30*time.Minute || !cfg.NoIndex || cfg.IndexNamespace != "qwen3-mlx" {
		t.Fatalf("runtime settings: %#v", cfg)
	}
}

func TestLoadDaemonRejectsInvalidRuntimeSettings(t *testing.T) {
	for _, tc := range []struct{ name, value string }{
		{EnvHealthTimeout, "soon"},
		{EnvRootPID, "launcher"},
		{EnvIndexNamespace, "../other"},
		{EnvIndexNamespace, ".hidden"},
	} {
		t.Run(tc.name+"="+tc.value, func(t *testing.T) {
			t.Setenv(EnvRoots, "")
			t.Setenv(tc.name, tc.value)

			_, err := LoadDaemon()

			var cfgErr *Error
			if !errors.As(err, &cfgErr) || cfgErr.Var != tc.name {
				t.Fatalf("expected invalid %s, got %v", tc.name, err)
			}
		})
	}
}

func TestMissingModelDisablesEmbeddingSettings(t *testing.T) {
	t.Setenv(EnvRoots, "")
	t.Setenv(EnvModel, "")
	t.Setenv(EnvEmbedBackend, "mlx")
	t.Setenv(EnvEmbedWorker, "/missing/worker.py")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.VectorsEnabled() || cfg.EmbedBackend != "" || cfg.EmbedWorker != "" {
		t.Fatalf("embedding settings without a model: %#v", cfg.Indexer)
	}
}
