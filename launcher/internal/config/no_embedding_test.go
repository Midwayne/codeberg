package config

import (
	"path/filepath"
	"testing"
)

func TestNoVectorIgnoresUnavailableSavedEmbedding(t *testing.T) {
	t.Setenv(KeyEmbedding, "retired-model")
	home := t.TempDir()
	off := false

	c, err := Load(Overrides{Home: home, ConfigFile: filepath.Join(home, "config"), Vector: &off})
	if err != nil {
		t.Fatalf("disabled embedding must not require a valid model: %v", err)
	}

	if c.Vector {
		t.Fatal("vector search must be disabled")
	}
}

func TestNoVectorClearsInheritedEmbeddingEnvironment(t *testing.T) {
	c := &Config{Home: t.TempDir()}

	for name, env := range map[string]map[string]string{"daemon": c.DaemonEnv(), "agent": c.AgentEnv()} {
		if env[KeyVector] != "false" {
			t.Errorf("%s did not receive the resolved vector mode", name)
		}

		for _, key := range []string{KeyEmbedModel, KeyIndexPath, KeyEmbedBackend, "CBERG_EMBED_WORKER", "CBERG_EMBED_PYTHON", "CBERG_LLAMA_SERVER"} {
			if value, ok := env[key]; !ok || value != "" {
				t.Errorf("%s must clear inherited %s", name, key)
			}
		}
	}
}
