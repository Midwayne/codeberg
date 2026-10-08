package supervisor

import (
	"context"
	"fmt"
	"os/exec"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
)

// WipeIndex uses the core's provider naming and hashing without loading a model
// or starting a watcher. Credentials stay in the child environment.
func WipeIndex(ctx context.Context, cfg config.Indexer, root string) error {
	bin, err := resolveBin(cfg.Bin)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--wipe-index", cfg.Index, root)
	cmd.Env = processEnv(cfg)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("deleting project vector index: %w", err)
	}

	return nil
}
