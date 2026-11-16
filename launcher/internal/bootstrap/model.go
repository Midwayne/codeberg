package bootstrap

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/embedding"
)

// prepareModel is replaced in tests.
var prepareModel = ensureModel

// ensureEmbedding prepares the embedding model when semantic search is on. A
// normal run that cannot prepare it (offline, mirror down, Python too old)
// starts without semantic search instead of failing; existing indexes are left
// untouched. An explicit `codeberg build` still reports the failure.
func ensureEmbedding(c *config.Config, root string, force bool) error {
	if !c.Vector {
		return nil
	}

	return embeddingSetupResult(c, force, prepareModel(c, root))
}

func embeddingSetupResult(c *config.Config, force bool, err error) error {
	if err == nil || force {
		return err
	}

	fmt.Fprintf(os.Stderr, "⚠ Semantic search is off for this run: the embedding runtime or model could not be prepared.\n"+
		"  %v\n  Chat and exact-text search still work. Retry with `codeberg build`.\n", err)
	c.Vector = false

	return nil
}

// ensureModel downloads the embedding model if absent, using the setup scripts
// that ship under root (the source checkout or the dist dir).
func ensureModel(c *config.Config, root string) error {
	if modelReady(c) {
		label := c.Embedding
		if label == "" {
			label = c.EmbedModel
		}

		skip(c, "embedding model "+label+" ("+c.EmbedBackend+")")
		return nil
	}

	if c.EmbedBackend != "onnx" {
		return prepareWorkerModel(c, root)
	}

	return fetchONNXModel(c, root)
}

// modelReady reports whether the model file exists and, for Python worker
// backends, its tokenizer and virtualenv do too.
func modelReady(c *config.Config) bool {
	if !exists(c.EmbedModel) {
		return false
	}

	switch c.EmbedBackend {
	case "mlx", "gemma-mlx", "sentence-transformers":
		model, _ := embedding.Lookup(c.Embedding)
		tokenizer := filepath.Join(filepath.Dir(c.EmbedModel), "tokenizer.json")
		python := filepath.Join(model.VenvPath(c.Home), "bin", "python")

		return exists(tokenizer) && exists(python)
	default:
		return true
	}
}

// prepareWorkerModel installs a Python-worker model and its virtualenv with
// scripts/embedding_setup.py.
func prepareWorkerModel(c *config.Config, root string) error {
	model, err := embedding.Lookup(c.Embedding)
	if err != nil {
		return err
	}

	step("preparing embedding model " + c.Embedding)
	script := filepath.Join(root, "scripts", "embedding_setup.py")
	cmd := exec.Command("python3", script, c.Embedding, model.HuggingFace, c.EmbedModel, model.VenvPath(c.Home))

	if err := runToStderr(cmd); err != nil {
		return fmt.Errorf("embedding setup: %w", err)
	}

	if !exists(c.EmbedModel) {
		return fmt.Errorf("embedding setup finished but %s is missing", c.EmbedModel)
	}

	return nil
}

// fetchONNXModel downloads the default ONNX model with scripts/fetch-model.sh
// into the launcher-owned model dir (the parent of EmbedModel), which lives
// under ~/.codeberg rather than the repo.
func fetchONNXModel(c *config.Config, root string) error {
	step("downloading embedding model (jina-embeddings-v2-base-code, ~160MB)")

	cmd := exec.Command(filepath.Join(root, "scripts", "fetch-model.sh"), filepath.Dir(c.EmbedModel))
	cmd.Dir = root

	if err := runToStderr(cmd); err != nil {
		return fmt.Errorf("fetch-model.sh failed: %w", err)
	}

	if !exists(c.EmbedModel) {
		return fmt.Errorf("model download finished but %s is missing", c.EmbedModel)
	}

	return nil
}

// runToStderr runs cmd with both output streams on stderr, keeping stdout
// free for command output.
func runToStderr(cmd *exec.Cmd) error {
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr

	return cmd.Run()
}
