package config

import (
	"os"
	"path/filepath"
	"strings"

	"codeberg.org/codeberg/launcher/internal/embedding"
)

func (c *Config) addEmbeddingEnv(e map[string]string) {
	embedModel := c.EmbedModel
	model, err := embedding.Lookup(c.Embedding)

	if err == nil && model.UsesVenv() {
		embedModel = filepath.Dir(embedModel)
		e["CBERG_EMBED_PYTHON"] = filepath.Join(model.VenvPath(c.Home), "bin", "python")
	}

	e[KeyEmbedModel] = embedModel
	e[KeyEmbedBackend] = c.EmbedBackend

	if c.IndexExplicit {
		e[KeyIndexPath] = c.IndexPath
	}

	if c.EmbedBackend == "onnx" {
		return
	}

	root, _ := c.ResolveRoot()
	e["CBERG_EMBED_WORKER"] = filepath.Join(root, "scripts", "embedding_worker.py")

	if bin := os.Getenv("CBERG_LLAMA_SERVER"); bin != "" {
		e["CBERG_LLAMA_SERVER"] = bin
	}
}

func (c *Config) addDaemonFile(e map[string]string) {
	for key, value := range c.daemonFile {
		if _, set := e[key]; !set {
			e[key] = value
		}
	}
}

// forwardFileKeys keeps daemon settings the launcher does not interpret,
// so a value in ~/.codeberg/config reaches codeberg-d. Dead keys are dropped.
func forwardFileKeys(fileVals map[string]string) map[string]string {
	out := map[string]string{}

	for key, value := range fileVals {
		if value == "" || !forwardFileKey(key) {
			continue
		}

		out[key] = value
	}

	if len(out) == 0 {
		return nil
	}

	return out
}

func forwardFileKey(key string) bool {
	switch key {
	case KeySocket, KeyGitDir:
		return false
	default:
		return strings.HasPrefix(key, "CBERG_") || key == KeyHealthTimeout || key == KeyIndexNamespace
	}
}
