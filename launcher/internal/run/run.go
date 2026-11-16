// Package run owns process lifecycle: it starts codeberg-d (which itself spawns
// and supervises the C cberg-index), waits for the daemon's /health to come up,
// then runs the browser-UI server (codeberg-web) in the foreground. When it
// exits — or the launcher is told to stop — it SIGTERMs the daemon, whose own
// shutdown tears the core down with it.
package run

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/console"
	"codeberg.org/codeberg/launcher/internal/deps"
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

// Run boots the daemon, waits for health, runs the browser UI, and cleans up.
// Launcher status goes to term; the browser UI keeps writing to the terminal.
func Run(c *config.Config, term *console.Terminal) error {
	// root is where the binaries and agent live (a prebuilt dist or the source
	// checkout's build tree); it is also the working directory for both children.
	root, _ := c.ResolveRoot()
	artifacts := config.LocateArtifacts(root)

	node, err := checkRunnable(c, artifacts)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(c.IndexPath), 0o755); err != nil {
		return err
	}

	logs, err := openLogs(c.Home)
	if err != nil {
		return err
	}
	defer logs.Close()

	search, err := searchControl(c, logs.searxng)
	if err != nil {
		return fmt.Errorf("starting web search control: %w", err)
	}
	defer search.Close()

	// Daemon + indexer output always goes to the log file. Verbose runs also
	// mirror it to the terminal during startup, so developers can watch files
	// being chunked and embedded without those logs interleaving with the web
	// server once it starts.
	progress := newStartupTee(logs.daemon, term, c.Verbose)
	daemon, err := startDaemon(artifacts.DaemonBin, root, c, progress)
	if err != nil {
		return err
	}

	daemonExited := make(chan struct{})
	go func() { _ = daemon.Wait(); close(daemonExited) }()

	stop := stopper(daemon, search, daemonExited)
	defer stop()

	// Indexing and embedding happen while we wait.
	if err := awaitDaemon(c, term, progress, daemonExited); err != nil {
		return err
	}

	// The browser UI shares this terminal's process group: SIGINT (Ctrl-C)
	// reaches the child and exits it. SIGTERM means "shut down", so we stop
	// the daemon and let the deferred teardown finish.
	defer stopOnSIGTERM(stop)()

	agentEnv := c.AgentEnv()
	// Resource monitoring attributes this launcher's managed process tree only.
	agentEnv["CODEBERG_RESOURCE_ROOT_PID"] = strconv.Itoa(os.Getpid())
	agentEnv["CODEBERG_SEARCH_CONTROL_URL"] = search.URL
	agentEnv["CODEBERG_SEARCH_CONTROL_TOKEN"] = search.Token

	if c.Verbose {
		fmt.Fprintln(term)
	}
	fmt.Fprint(term, readyMessage(fmt.Sprintf("http://127.0.0.1:%s", c.WebPort)))

	// The server binds a moment after node starts, so wait for the port to
	// accept connections before opening the browser — best effort.
	go openBrowserWhenReady(c.WebPort)

	front := exec.Command(node, artifacts.WebScript)
	front.Dir = root
	front.Env = mergeEnv(os.Environ(), agentEnv)
	front.Stdin = os.Stdin
	front.Stdout = io.MultiWriter(os.Stdout, logs.web)
	front.Stderr = io.MultiWriter(os.Stderr, logs.web)
	err = front.Run()

	stop()
	return frontEndResult(err)
}

// checkRunnable verifies the built components exist and returns the Node
// binary that runs the agent.
func checkRunnable(c *config.Config, artifacts config.Artifacts) (node string, err error) {
	if _, err := os.Stat(artifacts.DaemonBin); err != nil {
		return "", fmt.Errorf("daemon binary missing (%s); run `codeberg build`", artifacts.DaemonBin)
	}

	if _, err := os.Stat(artifacts.WebScript); err != nil {
		return "", fmt.Errorf("web UI server missing (%s); run `codeberg build`", artifacts.WebScript)
	}

	node, err = c.NodeBinary()
	if err != nil {
		return "", fmt.Errorf("node not found on PATH (the agent needs Node >=22)")
	}

	return node, deps.CheckNode(node)
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

// stopOnSIGTERM runs stop when the launcher receives SIGTERM. SIGINT is
// consumed and left to the foreground child. The returned function ends the
// subscription.
func stopOnSIGTERM(stop func()) (cancel func()) {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		for s := range signals {
			if s == syscall.SIGTERM {
				stop()
				return
			}
		}
	}()

	return func() { signal.Stop(signals) }
}

// frontEndResult maps the browser UI's exit to the launcher's: being ended by
// a signal (Ctrl-C) is a normal exit; other failures are surfaced.
func frontEndResult(err error) error {
	if err == nil {
		return nil
	}

	if exit, ok := err.(*exec.ExitError); ok {
		if status, ok := exit.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			return nil
		}
	}

	return fmt.Errorf("browser chat UI exited: %w", err)
}
