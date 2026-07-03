package gitpull

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"
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
				cmd := exec.CommandContext(ctx, "git", "-C", dir, "pull", "--ff-only")
				out, err := cmd.CombinedOutput()
				if err != nil {
					log.Printf("git pull %s: %v: %s", dir, err, out)
				}
			}
		}
	}
}
