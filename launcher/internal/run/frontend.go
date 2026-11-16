package run

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"syscall"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/searxng"
)

// frontEnd names the Node process that serves the browser UI.
type frontEnd struct {
	node   string
	root   string
	script string
}

// frontEndEnv is the agent environment plus the launcher-owned settings the
// browser UI needs to reach this run's search control and process tree.
func frontEndEnv(c *config.Config, search *searxng.ControlServer) map[string]string {
	env := c.AgentEnv()

	// Resource monitoring attributes this launcher's managed process tree only.
	env["CODEBERG_RESOURCE_ROOT_PID"] = strconv.Itoa(os.Getpid())
	env["CODEBERG_SEARCH_CONTROL_URL"] = search.URL
	env["CODEBERG_SEARCH_CONTROL_TOKEN"] = search.Token

	return env
}

// runFrontEnd runs the browser UI in the foreground on this terminal, copying
// its output to the web log.
func runFrontEnd(fe frontEnd, env map[string]string, logs *sessionLogs) error {
	cmd := exec.Command(fe.node, fe.script)
	cmd.Dir = fe.root
	cmd.Env = mergeEnv(os.Environ(), env)

	cmd.Stdin = os.Stdin
	cmd.Stdout = io.MultiWriter(os.Stdout, logs.web)
	cmd.Stderr = io.MultiWriter(os.Stderr, logs.web)

	return cmd.Run()
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
