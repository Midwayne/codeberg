package searxng

import (
	"errors"
	"os/exec"
	"syscall"
	"testing"
)

// TestStopKillsProcessGroup is the regression guard for the core lifecycle
// promise: when codeberg stops, the managed SearXNG must not linger. We stand in
// a `sleep` child (in its own process group, exactly as Start configures it),
// call Stop, and assert the whole group is gone.
func TestStopKillsProcessGroup(t *testing.T) {
	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("sleep not available")
	}
	cmd := exec.Command("sleep", "30")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting child: %v", err)
	}
	pid := cmd.Process.Pid

	// Sanity: the group is alive before Stop (signal 0 just probes existence).
	if err := syscall.Kill(-pid, 0); err != nil {
		t.Fatalf("child group should be alive before Stop: %v", err)
	}

	(&Manager{cmd: cmd, url: "http://127.0.0.1:0"}).Stop()

	if err := syscall.Kill(-pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("process group %d still alive after Stop (kill(0) = %v); it must be torn down", pid, err)
	}
}

func TestStopIsIdempotent(t *testing.T) {
	if _, err := exec.LookPath("sleep"); err != nil {
		t.Skip("sleep not available")
	}
	cmd := exec.Command("sleep", "30")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatalf("starting child: %v", err)
	}
	m := &Manager{cmd: cmd}
	m.Stop()
	m.Stop() // second call must not panic or block
}
