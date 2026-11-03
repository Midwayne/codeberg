package supervisor

import (
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/config"
)

func TestChunkOnlyProcessCannotInheritEmbeddingModel(t *testing.T) {
	keys := []string{config.EnvModel, config.EnvEmbedBackend, config.EnvEmbedWorker, config.EnvEmbedPython, config.EnvLlamaServer}
	for _, key := range keys {
		t.Setenv(key, "inherited-value")
	}

	for _, entry := range processEnv(config.Indexer{}) {
		key, value, _ := strings.Cut(entry, "=")
		for _, embeddingKey := range keys {
			if key == embeddingKey && value != "" {
				t.Errorf("chunk-only indexer inherited %s", key)
			}
		}
	}
}
