package searxng

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// EnsureInstalled installs the managed SearXNG, or upgrades it when upgrade is
// set. It is a no-op when already installed and not upgrading. Requires git and
// a host python3 (with venv). Returns an error the caller can downgrade to a
// warning — install failure must never be fatal. The context cancels the
// underlying git/pip/venv subprocesses, so a background install stops promptly
// when codeberg is torn down.
func EnsureInstalled(ctx context.Context, home string, upgrade bool, w io.Writer) error {
	l := layoutFor(home)
	if Installed(home) && !upgrade {
		return nil
	}

	py, ok := hostPython()
	if !ok {
		return fmt.Errorf("python3 not found (needed to install SearXNG for web_search)")
	}

	git, err := exec.LookPath("git")
	if err != nil {
		return fmt.Errorf("git not found (needed to fetch SearXNG)")
	}

	if err := os.MkdirAll(l.base, 0o755); err != nil {
		return err
	}

	if err := fetchSource(ctx, w, l, git, upgrade); err != nil {
		return err
	}

	if err := installRequirements(ctx, w, l, py); err != nil {
		return err
	}

	// Persist a stable secret so generated settings are deterministic.
	if _, err := ensureSecret(l); err != nil {
		return err
	}

	// Mark the install complete so Installed() reports true (and a failed run
	// above leaves no marker, so the next run retries).
	return os.WriteFile(l.ready, []byte("ok\n"), 0o644)
}

// fetchSource makes a shallow source checkout, or updates it on upgrade.
func fetchSource(ctx context.Context, w io.Writer, l layout, git string, upgrade bool) error {
	if dirExists(l.src) {
		if upgrade {
			_ = exec.CommandContext(ctx, git, "-C", l.src, "pull", "--ff-only").Run()
		}
		return nil
	}

	if err := runCmd(ctx, w, l.base, git, "clone", "--depth", "1", repoURL, l.src); err != nil {
		return fmt.Errorf("cloning SearXNG: %w", err)
	}

	return nil
}

// installRequirements creates the virtualenv and installs SearXNG's runtime
// dependencies into it.
//
// We deliberately do NOT `pip install -e .`. SearXNG's setup.py imports the
// package at build time (`from searx import get_setting`), and the package's
// __init__ imports msgspec — but under PEP 517 build isolation msgspec isn't
// in the throwaway build env yet, so the editable build dies with
// "No module named 'msgspec'". Instead we install requirements.txt and run
// `python -m searx.webapp` from the checkout (searx resolves from the working
// directory) — exactly SearXNG's own from-source dev mode.
func installRequirements(ctx context.Context, w io.Writer, l layout, py string) error {
	if !fileExists(l.python()) {
		if err := runCmd(ctx, w, l.base, py, "-m", "venv", l.venv); err != nil {
			return fmt.Errorf("creating venv (install python3-venv?): %w", err)
		}
	}

	_ = runCmd(ctx, w, l.base, l.python(), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")

	requirements := filepath.Join(l.src, "requirements.txt")
	if err := runCmd(ctx, w, l.base, l.python(), "-m", "pip", "install", "-r", requirements); err != nil {
		return fmt.Errorf("pip install SearXNG requirements: %w", err)
	}

	return nil
}

func ensureSecret(l layout) (string, error) {
	if b, err := os.ReadFile(l.secret); err == nil {
		if s := strings.TrimSpace(string(b)); len(s) >= 16 {
			return s, nil
		}
	}
	if err := os.MkdirAll(l.base, 0o755); err != nil {
		return "", err
	}
	s, err := randomSecret()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(l.secret, []byte(s), 0o600); err != nil {
		return "", err
	}
	return s, nil
}

func randomSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// runCmd runs one setup command in its own process group, output to w.
func runCmd(ctx context.Context, w io.Writer, dir, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = w
	cmd.Stderr = w
	// git, pip and venv may spawn children that outlive their immediate parent.
	// Cancelling setup must release the entire installer process group.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}

	return cmd.Run()
}
