package config

import (
	"os"
	"strings"
)

// loadEmbedding is the one place that decides whether the indexer embeds:
// CODEBERG_VECTOR=false or a missing model turns every embedding setting off,
// so inherited worker settings never reach the indexer on their own.
func loadEmbedding(idx *Indexer) {
	if !isFalse(os.Getenv(EnvVector)) {
		idx.Model = os.Getenv(EnvModel)
	}

	if idx.Model == "" {
		return
	}

	idx.EmbedBackend = os.Getenv(EnvEmbedBackend)
	idx.EmbedWorker = os.Getenv(EnvEmbedWorker)
	idx.EmbedPython = os.Getenv(EnvEmbedPython)
	idx.LlamaServer = os.Getenv(EnvLlamaServer)
}

func isFalse(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "false", "0", "off", "no":
		return true
	default:
		return false
	}
}

func isTrue(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "on", "yes":
		return true
	default:
		return false
	}
}
