package gitpull

import (
	"context"
	"log"
	"os/exec"
	"time"
)

func Run(ctx context.Context, dir string, interval time.Duration) {
	if interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cmd := exec.CommandContext(ctx, "git", "-C", dir, "pull", "--ff-only")
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Printf("git pull: %v: %s", err, out)
			}
		}
	}
}
