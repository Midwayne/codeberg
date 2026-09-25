package bootstrap

import (
	"context"
	"fmt"
	"os"
	"time"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

const (
	minimumStartupTimeout = 15 * time.Minute
	startupTimeoutPerRepo = 5 * time.Minute
)

// StartupTimeout scales indexer wait with repo count, with enough time for a
// cold single-repo embedding pass and a 60-minute upper bound.
func StartupTimeout(repos int) time.Duration {
	if v := os.Getenv("CODEBERG_HEALTH_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	if repos < 1 {
		repos = 1
	}

	d := time.Duration(repos) * startupTimeoutPerRepo
	if d < minimumStartupTimeout {
		return minimumStartupTimeout
	}
	if max := 60 * time.Minute; d > max {
		return max
	}

	return d
}

// WaitIndexer polls until the indexer reports ready or ctx is canceled.
// On timeout, the last Status error (if any) is included for diagnosis.
func WaitIndexer(ctx context.Context, c *indexctl.Client) (indexctl.Status, error) {
	var lastErr error
	for {
		st, err := c.Status(ctx)
		if err == nil && st.Ready {
			return st, nil
		}
		if err != nil {
			lastErr = err
		}

		select {
		case <-ctx.Done():
			if lastErr != nil {
				return indexctl.Status{}, fmt.Errorf("%w (last status: %v)", ctx.Err(), lastErr)
			}
			return indexctl.Status{}, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}
