// Package run owns process lifecycle: it starts codeberg-d (which itself spawns
// and supervises the C cberg-index), waits for the daemon's /health to come up,
// then hands the terminal to the Node TUI. When the TUI exits — or the launcher
// is told to stop — it SIGTERMs the daemon, whose own shutdown tears the core
// down with it.
package run

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"codeberg.org/codeberg/launcher/internal/config"
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
// when it parses as a Go duration, otherwise the default.
func healthDeadline() time.Duration {
	if v := os.Getenv("CODEBERG_HEALTH_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
		fmt.Fprintf(os.Stderr, "› ignoring invalid CODEBERG_HEALTH_TIMEOUT=%q (want a duration like 30m)\n", v)
	}
	return defaultHealthDeadline
}

// Run boots the daemon, waits for health, runs the TUI, and cleans up.
func Run(c *config.Config) error {
	// root is where the binaries and agent live (a prebuilt dist or the source
	// checkout's build tree); it is also the working directory for both children.
	root, _ := c.ResolveRoot()
	a := config.LocateArtifacts(root)
	if _, err := os.Stat(a.DaemonBin); err != nil {
		return fmt.Errorf("daemon binary missing (%s); run `codeberg build`", a.DaemonBin)
	}
	if _, err := os.Stat(a.TUIScript); err != nil {
		return fmt.Errorf("agent TUI missing (%s); run `codeberg build`", a.TUIScript)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return fmt.Errorf("node not found on PATH (the agent TUI needs Node >=22)")
	}

	if err := os.MkdirAll(filepath.Dir(c.IndexPath), 0o755); err != nil {
		return err
	}
	logDir := filepath.Join(c.Home, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}
	logPath := filepath.Join(logDir, "daemon.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return err
	}

	// --- start the daemon -----------------------------------------------------
	// Daemon + indexer output always goes to the log file, and is mirrored to the
	// terminal only during startup — so the user watches files being chunked and
	// embedded, without those logs corrupting the TUI once it takes over.
	progress := newStartupTee(logFile, os.Stderr)
	daemon, err := startDaemon(a.DaemonBin, root, c, progress)
	if err != nil {
		return err
	}
	// Single, idempotent teardown: SIGTERM the daemon's process group, then
	// SIGKILL if it overstays. The daemon's signal handler stops the supervisor,
	// which interrupts cberg-index.
	stopped := make(chan struct{})
	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() {
			pgid := -daemon.Process.Pid
			_ = syscall.Kill(pgid, syscall.SIGTERM)
			select {
			case <-stopped:
			case <-time.After(5 * time.Second):
				_ = syscall.Kill(pgid, syscall.SIGKILL)
			}
		})
	}
	go func() { _ = daemon.Wait(); close(stopped) }()
	defer stop()

	// --- wait for /health (indexing + embedding happen here) ------------------
	fmt.Fprintf(os.Stderr, "› starting daemon — indexing %s\n", c.Root)
	fmt.Fprintf(os.Stderr, "  (first run builds the index; live progress below — full log: %s)\n\n", logPath)
	if err := waitHealthy(c.DaemonURL, stopped); err != nil {
		progress.stopLive()
		fmt.Fprint(os.Stderr, tailFile(logPath, 20))
		return err
	}
	progress.stopLive()
	fmt.Fprintf(os.Stderr, "\n✓ daemon ready at %s — launching chat\n\n", c.DaemonURL)

	// --- run the TUI in the foreground ---------------------------------------
	// SIGINT (Ctrl-C) is left to the TUI, which shares this terminal's process
	// group and uses it to interrupt generation. SIGTERM means "shut down", so
	// we stop the daemon and let the deferred teardown finish.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	go func() {
		for s := range sigCh {
			if s == syscall.SIGTERM {
				stop()
				return
			}
		}
	}()

	tui := exec.Command(node, a.TUIScript)
	tui.Dir = root
	tui.Env = mergeEnv(os.Environ(), c.AgentEnv())
	tui.Stdin = os.Stdin
	tui.Stdout = os.Stdout
	tui.Stderr = os.Stderr
	err = tui.Run()

	stop()
	if err != nil {
		// A non-zero TUI exit from Ctrl-C is normal; surface other failures.
		if ee, ok := err.(*exec.ExitError); ok {
			if status, ok := ee.Sys().(syscall.WaitStatus); ok && status.Signaled() {
				return nil
			}
		}
		return fmt.Errorf("agent TUI exited: %w", err)
	}
	return nil
}

func startDaemon(bin, root string, c *config.Config, out io.Writer) (*exec.Cmd, error) {
	cmd := exec.Command(bin)
	cmd.Dir = root
	cmd.Env = mergeEnv(os.Environ(), c.DaemonEnv())
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

// startupTee records daemon/indexer output to the log unconditionally, and
// mirrors it to the terminal only while "live" — i.e. during startup, so the
// user sees indexing/embedding progress, but the stream stops before the TUI
// owns the screen.
type startupTee struct {
	mu   sync.Mutex
	log  io.Writer
	term io.Writer
	live bool
}

func newStartupTee(logw, termw io.Writer) *startupTee {
	return &startupTee{log: logw, term: termw, live: true}
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
func waitHealthy(daemonURL string, daemonStopped <-chan struct{}) error {
	deadline := healthDeadline()
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
		// Progress is shown by streaming the daemon/indexer log (see startupTee).
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

// mergeEnv overlays overrides onto base, replacing (not duplicating) keys.
func mergeEnv(base []string, overrides map[string]string) []string {
	out := make([]string, 0, len(base)+len(overrides))
	for _, kv := range base {
		key := kv
		if i := indexByte(kv, '='); i >= 0 {
			key = kv[:i]
		}
		if _, ok := overrides[key]; ok {
			continue
		}
		out = append(out, kv)
	}
	for k, v := range overrides {
		out = append(out, k+"="+v)
	}
	return out
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

func tailFile(path string, lines int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	all := splitLines(string(data))
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	out := "--- daemon.log (tail) ---\n"
	for _, l := range all {
		out += l + "\n"
	}
	return out
}

func splitLines(s string) []string {
	var out []string
	cur := ""
	for _, r := range s {
		if r == '\n' {
			out = append(out, cur)
			cur = ""
			continue
		}
		cur += string(r)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
