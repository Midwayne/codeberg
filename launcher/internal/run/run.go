// Package run owns process lifecycle: it starts codeberg-d (which itself spawns
// and supervises the C cberg-index), waits for the daemon's /health to come up,
// then runs the Node front end in the foreground — the terminal TUI by default,
// or the browser-UI server (codeberg-web) when c.Web is set. When that front end
// exits — or the launcher is told to stop — it SIGTERMs the daemon, whose own
// shutdown tears the core down with it.
package run

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/searxng"
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
	// web_search is backed by a local SearXNG the launcher owns. Bring it up in
	// the background (concurrent with indexing) so a first-time install — git
	// clone + pip, often minutes — never blocks startup. The handle is shared
	// under searxMu; teardown cancels an in-flight install and stops it. Because
	// it runs in its own process group, nothing is ever left behind.
	var (
		searx   *searxng.Manager
		searxMu sync.Mutex
	)
	webCtx, webCancel := context.WithCancel(context.Background())
	webDone := make(chan struct{})
	launchWeb := c.WebUse && c.SearxngURL == ""
	if launchWeb {
		go bringUpSearch(webCtx, c, logFile, webDone, &searxMu, &searx)
	} else {
		close(webDone)
	}

	// Single, idempotent teardown: stop the managed SearXNG (cancelling an
	// in-flight install), then SIGTERM the daemon's process group, SIGKILL if it
	// overstays. The daemon's signal handler stops the supervisor, which
	// interrupts cberg-index.
	stopped := make(chan struct{})
	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() {
			webCancel()
			select {
			case <-webDone:
			case <-time.After(3 * time.Second):
			}
			searxMu.Lock()
			if searx != nil {
				searx.Stop()
			}
			searxMu.Unlock()
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
	if c.All || len(c.Repos) > 0 || len(c.Roots) > 1 {
		keys := make([]string, 0, len(c.Roots))
		for _, r := range c.Roots {
			keys = append(keys, r.Key)
		}
		fmt.Fprintf(os.Stderr, "› starting daemon — indexing %d repo(s): %s\n", len(c.Roots), strings.Join(keys, ", "))
	} else if len(c.Roots) == 1 {
		fmt.Fprintf(os.Stderr, "› starting daemon — indexing %s\n", c.Roots[0].Root)
	} else {
		fmt.Fprintf(os.Stderr, "› starting daemon — indexing %s\n", c.Root)
	}
	if c.NoIndex {
		fmt.Fprintf(os.Stderr, "  (--no-index: nothing registered or written; semantic search is off this run — full log: %s)\n\n", logPath)
	} else {
		fmt.Fprintf(os.Stderr, "  (first run builds the index; live progress below — full log: %s)\n\n", logPath)
	}
	if err := waitHealthy(c.DaemonURL, stopped, len(c.Roots)); err != nil {
		progress.stopLive()
		fmt.Fprint(os.Stderr, tailFile(logPath, 20))
		return err
	}
	progress.stopLive()

	// --- hand the agent the web-search URL if it came up ----------------------
	// Give an already-installed instance a brief grace to finish starting (warm
	// runs usually beat this), but never wait on a first-time background install:
	// web_search simply lights up on a later run. Nothing here is fatal.
	agentEnv := c.AgentEnv()
	if launchWeb {
		select {
		case <-webDone:
		case <-time.After(8 * time.Second):
		}
		searxMu.Lock()
		m := searx
		searxMu.Unlock()
		if m != nil {
			agentEnv[config.KeySearxngURL] = m.URL()
			fmt.Fprintf(os.Stderr, "✓ web search ready at %s\n", m.URL())
		} else {
			fmt.Fprintln(os.Stderr, "› web search still setting up in the background; it'll be available on a later run")
		}
	}

	// --- run the front end in the foreground ---------------------------------
	// Either the terminal TUI or, with --web, the browser-UI server. Both share
	// this terminal's process group: SIGINT (Ctrl-C) reaches the child, which
	// uses it to interrupt generation (TUI) or to exit (web). SIGTERM means
	// "shut down", so we stop the daemon and let the deferred teardown finish.
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

	label := "chat"
	script := a.TUIScript
	if c.Web {
		label = "browser chat UI"
		script = a.WebScript
		if _, err := os.Stat(script); err != nil {
			return fmt.Errorf("web UI server missing (%s); run `codeberg build`", script)
		}
		url := fmt.Sprintf("http://127.0.0.1:%s", c.WebPort)
		fmt.Fprintf(os.Stderr, "\n✓ daemon ready — serving the chat UI at %s\n  (opening your browser; press Ctrl-C here to stop)\n\n", url)
		// The server binds a moment after node starts, so wait for the port to
		// accept connections before opening the browser — best effort.
		go openBrowserWhenReady(c.WebPort)
	} else {
		fmt.Fprintf(os.Stderr, "\n✓ daemon ready at %s — launching chat\n\n", c.DaemonURL)
	}

	front := exec.Command(node, script)
	front.Dir = root
	front.Env = mergeEnv(os.Environ(), agentEnv)
	front.Stdin = os.Stdin
	front.Stdout = os.Stdout
	front.Stderr = os.Stderr
	err = front.Run()

	stop()
	if err != nil {
		// A non-zero exit from Ctrl-C is normal; surface other failures.
		if ee, ok := err.(*exec.ExitError); ok {
			if status, ok := ee.Sys().(syscall.WaitStatus); ok && status.Signaled() {
				return nil
			}
		}
		return fmt.Errorf("agent %s exited: %w", label, err)
	}
	return nil
}

// openBrowserWhenReady polls the local web port until it accepts a connection
// (or a short deadline passes), then opens the default browser at that URL. It
// is best effort: any failure just leaves the user to open the URL themselves.
func openBrowserWhenReady(port string) {
	addr := net.JoinHostPort("127.0.0.1", port)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 500*time.Millisecond)
		if err == nil {
			conn.Close()
			openBrowser("http://" + addr)
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// openBrowser launches the platform's default handler for url, detached, and
// ignores the result — codeberg keeps running whether or not a browser opens.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default: // linux, *bsd
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

// bringUpSearch installs (if needed) and starts the managed SearXNG in the
// background, publishing the running manager via mu/dst once it is ready. It is
// best effort: any problem is logged and leaves web_search unavailable (fetch_url
// still works). There are no interactive steps — python is auto-installed only by
// `codeberg build`, never here under a live TUI — and the context cancels an
// in-flight install so teardown never blocks.
func bringUpSearch(
	ctx context.Context,
	c *config.Config,
	logw io.Writer,
	done chan<- struct{},
	mu *sync.Mutex,
	dst **searxng.Manager,
) {
	defer close(done)
	if !searxng.Installed(c.Home) {
		if !searxng.Available() {
			fmt.Fprintln(os.Stderr, "› web search needs python3 — run `codeberg build` to set it up (fetch_url still works)")
			return
		}
		fmt.Fprintln(os.Stderr, "› setting up web search (SearXNG) in the background — first run only")
		if err := searxng.EnsureInstalled(ctx, c.Home, false, logw); err != nil {
			if ctx.Err() == nil {
				fmt.Fprintf(os.Stderr, "  web search setup skipped: %v (fetch_url still works)\n", err)
			}
			return
		}
	}
	m, err := searxng.Start(ctx, c.Home, c.SearxngPort, logw)
	if err != nil {
		if ctx.Err() == nil {
			fmt.Fprintf(os.Stderr, "  web search unavailable: %v (fetch_url still works)\n", err)
		}
		return
	}
	mu.Lock()
	*dst = m
	mu.Unlock()
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
func waitHealthy(daemonURL string, daemonStopped <-chan struct{}, repos int) error {
	deadline := healthDeadline(repos)
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
