// Package run owns process lifecycle: it starts codeberg-d (which itself spawns
// and supervises the C cberg-index), waits for the daemon's /health to come up,
// then hands the terminal to the Node TUI. When the TUI exits — or the launcher
// is told to stop — it SIGTERMs the daemon, whose own shutdown tears the core
// down with it.
package run

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"codeberg.org/codeberg/launcher/internal/bootstrap"
	"codeberg.org/codeberg/launcher/internal/config"
)

// healthDeadline bounds how long we wait for the daemon to serve /health. The
// daemon only starts its HTTP server after the indexer reports ready, and a
// first index of a large tree can take a while — so we are generous.
const healthDeadline = 6 * time.Minute

// Run boots the daemon, waits for health, runs the TUI, and cleans up.
func Run(c *config.Config) error {
	a := bootstrap.Locate(c.Repo)
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

	// --- start the daemon -----------------------------------------------------
	daemon, err := startDaemon(a.DaemonBin, c, logPath)
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

	// --- wait for /health -----------------------------------------------------
	fmt.Fprintf(os.Stderr, "› starting daemon (logs: %s)\n", logPath)
	if err := waitHealthy(c.DaemonURL, stopped); err != nil {
		fmt.Fprint(os.Stderr, tailFile(logPath, 20))
		return err
	}
	fmt.Fprintf(os.Stderr, "✓ daemon ready at %s — launching chat\n\n", c.DaemonURL)

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
	tui.Dir = c.Repo
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

func startDaemon(bin string, c *config.Config, logPath string) (*exec.Cmd, error) {
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, err
	}
	cmd := exec.Command(bin)
	cmd.Dir = c.Repo
	cmd.Env = mergeEnv(os.Environ(), c.DaemonEnv())
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	// Own process group so the terminal's Ctrl-C does not reach the daemon — we
	// manage its lifecycle explicitly.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("starting daemon: %w", err)
	}
	return cmd, nil
}

// waitHealthy polls GET <url>/health until it returns 2xx, the daemon exits, or
// the deadline passes.
func waitHealthy(daemonURL string, daemonStopped <-chan struct{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), healthDeadline)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Second}
	url := daemonURL + "/health"

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	start := time.Now()
	for {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if resp, err := client.Do(req); err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		}
		fmt.Fprintf(os.Stderr, "\r  waiting for daemon… %ds", int(time.Since(start).Seconds()))
		select {
		case <-daemonStopped:
			fmt.Fprintln(os.Stderr)
			return fmt.Errorf("daemon exited before becoming healthy")
		case <-ctx.Done():
			fmt.Fprintln(os.Stderr)
			return fmt.Errorf("daemon did not become healthy within %s", healthDeadline)
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
