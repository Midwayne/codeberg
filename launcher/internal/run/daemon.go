package run

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"

	"codeberg.org/codeberg/launcher/internal/config"
)

func startDaemon(bin, root string, c *config.Config, out io.Writer) (*exec.Cmd, error) {
	cmd := exec.Command(bin)
	cmd.Dir = root
	env := c.DaemonEnv()
	env["CODEBERG_RESOURCE_ROOT_PID"] = strconv.Itoa(os.Getpid())
	cmd.Env = mergeEnv(os.Environ(), env)
	// Same writer for both streams: os/exec then serializes Write calls for us.
	cmd.Stdout = out
	cmd.Stderr = out
	// Own process group so the terminal's Ctrl-C does not reach the daemon — we
	// manage its lifecycle explicitly.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting daemon: %w", err)
	}
	return cmd, nil
}

// stopper returns the single, idempotent teardown: release the search
// service (cancelling an in-flight install), then SIGTERM the daemon's process
// group, SIGKILL if it overstays. The daemon's signal handler stops the
// supervisor, which interrupts cberg-index. exited closes once the daemon is
// gone.
func stopper(daemon *exec.Cmd, search interface{ Close() }, exited <-chan struct{}) func() {
	var once sync.Once

	return func() {
		once.Do(func() {
			search.Close()

			group := -daemon.Process.Pid
			_ = syscall.Kill(group, syscall.SIGTERM)

			select {
			case <-exited:
			case <-time.After(5 * time.Second):
				_ = syscall.Kill(group, syscall.SIGKILL)
			}
		})
	}
}

// startupTee records daemon/indexer output to the log unconditionally, and
// mirrors it to the terminal only while "live" — i.e. during a verbose startup,
// so developers see indexing/embedding progress before the browser UI starts.
type startupTee struct {
	mu   sync.Mutex
	log  io.Writer
	term io.Writer
	live bool
}

func newStartupTee(logw, termw io.Writer, live bool) *startupTee {
	return &startupTee{log: logw, term: termw, live: live}
}

func (t *startupTee) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.live {
		_, _ = t.term.Write(p)
	}
	return t.log.Write(p)
}

func (t *startupTee) stopLive() {
	t.mu.Lock()
	t.live = false
	t.mu.Unlock()
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
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if resp, err := client.Do(req); err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
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
