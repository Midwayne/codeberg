package gitpull

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"time"

	"codeberg.org/codeberg/daemon/internal/git"
)

// Run pulls each dir on every tick. Dirs without a .git entry are skipped
// quietly — in --all mode plain (non-git) directories are legitimate roots.
func Run(ctx context.Context, dirs []string, interval time.Duration) {
	if interval <= 0 || len(dirs) == 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, dir := range dirs {
				if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
					continue
				}
				if _, err := git.Run(ctx, dir, "pull", "--ff-only"); err != nil {
					log.Printf("git pull %s: %v", dir, err)
				}
			}
		}
	}
}
