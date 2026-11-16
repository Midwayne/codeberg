package run

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"

	"codeberg.org/codeberg/launcher/internal/config"
)

// startDaemon starts codeberg-d in its own process group, writing both of its
// output streams to out.
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
// so developers see indexing/embedding progress before the browser UI starts,
// without those logs interleaving with the web server's once it does.
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
