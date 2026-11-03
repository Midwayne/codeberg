package config

import (
	"os"
	"strings"
)

func disableEmbedding(idx *Indexer) {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CODEBERG_VECTOR"))) {
	case "false", "0", "off", "no":
		idx.Model = ""
		idx.EmbedBackend = ""
		idx.EmbedWorker = ""
		idx.EmbedPython = ""
		idx.LlamaServer = ""
	}
}
