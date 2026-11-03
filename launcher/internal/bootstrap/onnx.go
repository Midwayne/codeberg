package bootstrap

import (
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"time"

	"codeberg.org/codeberg/launcher/internal/config"
)

func needsONNXBuild(c *config.Config, indexer string) bool {
	return c.Vector && c.EmbedBackend == "onnx" && !indexerHasONNX(indexer)
}

// Query the binary instead of CMake's cache: an older executable may still be
// present after a failed rebuild or a change to installed native libraries.
func indexerHasONNX(indexer string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	output, err := exec.CommandContext(ctx, indexer, "--capabilities").Output()
	if err != nil {
		return false
	}

	var capabilities struct {
		ONNX bool `json:"onnx"`
	}

	return json.Unmarshal(output, &capabilities) == nil && capabilities.ONNX
}

func ensureONNX(c *config.Config, indexer string, force bool) error {
	if !needsONNXBuild(c, indexer) {
		return nil
	}

	err := errors.New("the rebuilt indexer has no usable ONNX support; install ONNX Runtime " +
		"(brew install onnxruntime on macOS, or export ONNXRUNTIME_ROOT to its installation prefix), " +
		"then retry with codeberg build --vector --embedding jina-onnx")

	return embeddingSetupResult(c, force, err)
}
