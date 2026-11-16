// Package run owns process lifecycle: it starts codeberg-d (which itself spawns
// and supervises the C cberg-index), waits for the daemon's /health to come up,
// then runs the browser-UI server (codeberg-web) in the foreground. When it
// exits — or the launcher is told to stop — it SIGTERMs the daemon, whose own
// shutdown tears the core down with it.
package run

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/console"
	"codeberg.org/codeberg/launcher/internal/deps"
)

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

	// Daemon output goes to its log; verbose runs mirror it during startup.
	progress := newStartupTee(logs.daemon, term, c.Verbose)
	daemon, err := startDaemon(artifacts.DaemonBin, root, c, progress)
	if err != nil {
		return err
	}

	daemonExited := watchExit(daemon)
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

	announceReady(term, c)
	err = runFrontEnd(frontEnd{node: node, root: root, script: artifacts.WebScript}, frontEndEnv(c, search), logs)

	stop()
	return frontEndResult(err)
}

// checkRunnable verifies the built components exist, creates the index
// directory, and returns the Node binary that runs the agent.
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

	if err := deps.CheckNode(node); err != nil {
		return "", err
	}

	// The index directory must exist before the daemon opens it.
	return node, os.MkdirAll(filepath.Dir(c.IndexPath), 0o755)
}

// watchExit returns a channel that closes once the process has exited.
func watchExit(cmd *exec.Cmd) <-chan struct{} {
	exited := make(chan struct{})

	go func() {
		_ = cmd.Wait()
		close(exited)
	}()

	return exited
}

// announceReady prints the browser URL and opens it once the web server
// accepts connections — best effort, since it binds a moment after node starts.
func announceReady(term *console.Terminal, c *config.Config) {
	if c.Verbose {
		fmt.Fprintln(term)
	}

	fmt.Fprint(term, readyMessage(fmt.Sprintf("http://127.0.0.1:%s", c.WebPort)))

	go openBrowserWhenReady(c.WebPort)
}
