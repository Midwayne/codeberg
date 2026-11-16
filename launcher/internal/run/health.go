package run

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/console"
)

// defaultHealthDeadline bounds how long we wait for the daemon to serve
// /health. The daemon only starts its HTTP server after the indexer reports
// ready, and a *first* index of a large tree — parse every file, embed every
// chunk through ONNX — routinely runs past six minutes, which used to trip the
// old deadline and force a second `codeberg` run (the rebuilt index then warm-
// starts). Fifteen minutes covers a cold index of a large repo; override with
// CODEBERG_HEALTH_TIMEOUT (any Go duration, e.g. "30m") for the truly huge.
const defaultHealthDeadline = 15 * time.Minute

// healthDeadline returns the configured wait, honoring CODEBERG_HEALTH_TIMEOUT
// when it parses as a Go duration, otherwise the default scaled by how many
// repos this run indexes — a first `--all` may cold-index several trees back
// to back through one embedder.
func healthDeadline(repos int) time.Duration {
	if v := os.Getenv("CODEBERG_HEALTH_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
		fmt.Fprintf(os.Stderr, "› ignoring invalid CODEBERG_HEALTH_TIMEOUT=%q (want a duration like 30m)\n", v)
	}

	d := defaultHealthDeadline
	if scaled := time.Duration(repos) * 5 * time.Minute; scaled > d {
		d = scaled
	}

	return d
}

// awaitDaemon shows startup status until the daemon serves /health. On
// failure it prints the end of the daemon log, where the cause usually is.
func awaitDaemon(c *config.Config, term *console.Terminal, progress *startupTee, daemonExited <-chan struct{}) error {
	logPath := filepath.Join(c.Home, "logs", "daemon.log")

	stopStatus := announceStartup(term, c, logPath)
	err := waitHealthy(c.DaemonURL, daemonExited, healthDeadline(len(c.Roots)))
	stopStatus()
	progress.stopLive()

	if err != nil {
		fmt.Fprint(term, tailFile(logPath, 20))
	}

	return err
}

// waitHealthy polls GET <url>/health until it returns 2xx, the daemon exits, or
// the deadline passes.
func waitHealthy(daemonURL string, daemonStopped <-chan struct{}, deadline time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), deadline)
	defer cancel()

	client := &http.Client{Timeout: 2 * time.Second}
	url := daemonURL + "/health"

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		if healthy(ctx, client, url) {
			return nil
		}

		// Progress is a status line, or the mirrored daemon log when verbose.
		select {
		case <-daemonStopped:
			return fmt.Errorf("daemon exited before becoming healthy")
		case <-ctx.Done():
			return fmt.Errorf("daemon did not become healthy within %s "+
				"(raise it with CODEBERG_HEALTH_TIMEOUT, e.g. 30m, for a very large first index)", deadline)
		case <-ticker.C:
		}
	}
}

// healthy reports whether one GET of url answered 2xx.
func healthy(ctx context.Context, client *http.Client, url string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 300
}
