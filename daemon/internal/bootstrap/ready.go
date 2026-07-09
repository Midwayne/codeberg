package bootstrap

import (
	"context"
	"fmt"
	"time"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

const startupTimeoutPerRepo = 5 * time.Minute

// StartupTimeout scales indexer wait with repo count (bounded at 60 minutes).
func StartupTimeout(repos int) time.Duration {
	if repos < 1 {
		repos = 1
	}

	d := time.Duration(repos) * startupTimeoutPerRepo
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
