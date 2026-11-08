package config

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/embedding"
)

// applyIndex records an explicit index path and the namespace that keeps
// embedding models apart. An empty path means the daemon chooses
// projects/<id>/index/<namespace>/.
func (c *Config) applyIndex(path, namespace string) {
	c.IndexExplicit = path != ""
	c.IndexPath = abs(path)

	if namespace != "" {
		c.IndexNamespace = namespace
		return
	}

	c.IndexNamespace = derivedNamespace(c)
}

func derivedNamespace(c *Config) string {
	if !c.Vector {
		return ""
	}

	if c.Embedding != "" {
		model, err := embedding.Lookup(c.Embedding)
		if err != nil {
			return ""
		}

		return model.Namespace()
	}

	def := filepath.Join(c.Home, "models", "jina-embeddings-v2-base-code", "model.onnx")
	if filepath.Clean(c.EmbedModel) == filepath.Clean(def) {
		return ""
	}

	sum := sha256.Sum256([]byte(filepath.Clean(c.EmbedModel)))
	return "model-" + hex.EncodeToString(sum[:4])
}
