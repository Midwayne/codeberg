// Package searxng manages a local, open-source SearXNG instance that backs the
// agent's web_search tool. There is deliberately no vendor and no API key: the
// launcher installs SearXNG into a managed Python venv under the launcher home
// and runs it as a child process whose lifetime is bound to codeberg.
//
// Lifecycle is the whole point of this package. The process is started in its
// own process group and Stop() signals that group, so when codeberg exits (or
// is told to stop) nothing is left running in the background — the same model
// the launcher already uses for the daemon.
//
// Everything here degrades gracefully: if python3 is missing, or the install or
// launch fails, web_search is simply unavailable and the agent's fetch_url tool
// (and the rest of codeberg) keeps working. Callers treat returned errors as
// advisory and continue.
package searxng

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const repoURL = "https://github.com/searxng/searxng.git"

// readyTimeout bounds how long Start waits for the instance to answer /healthz
// before giving up (and degrading to "web_search unavailable").
const readyTimeout = 30 * time.Second

// layout is the on-disk layout of the managed install under <home>/searxng.
type layout struct {
	base     string // <home>/searxng
	src      string // git checkout
	venv     string // python virtualenv
	settings string // generated settings.yml
	secret   string // persistent secret_key
}

func layoutFor(home string) layout {
	base := filepath.Join(home, "searxng")
	return layout{
		base:     base,
		src:      filepath.Join(base, "src"),
		venv:     filepath.Join(base, "venv"),
		settings: filepath.Join(base, "settings.yml"),
		secret:   filepath.Join(base, "secret"),
	}
}

func (l layout) python() string { return filepath.Join(l.venv, "bin", "python") }

// hostPython finds a system python to build the venv from.
func hostPython() (string, bool) {
	for _, name := range []string{"python3", "python"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, true
		}
	}
	return "", false
}

// Available reports whether SearXNG could be installed here (a host python exists).
func Available() bool { _, ok := hostPython(); return ok }

// Installed reports whether the managed venv + source checkout are present.
func Installed(home string) bool {
	l := layoutFor(home)
	return fileExists(l.python()) && dirExists(l.src)
}

// EnsureInstalled installs the managed SearXNG, or upgrades it when upgrade is
// set. It is a no-op when already installed and not upgrading. Requires git and
// a host python3 (with venv). Returns an error the caller can downgrade to a
// warning — install failure must never be fatal.
func EnsureInstalled(home string, upgrade bool, w io.Writer) error {
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

	// 1. Source checkout (shallow). Update it on upgrade.
	if dirExists(l.src) {
		if upgrade {
			_ = exec.Command(git, "-C", l.src, "pull", "--ff-only").Run()
		}
	} else if err := runCmd(w, l.base, git, "clone", "--depth", "1", repoURL, l.src); err != nil {
		return fmt.Errorf("cloning SearXNG: %w", err)
	}

	// 2. Virtualenv.
	if !fileExists(l.python()) {
		if err := runCmd(w, l.base, py, "-m", "venv", l.venv); err != nil {
			return fmt.Errorf("creating venv (install python3-venv?): %w", err)
		}
	}

	// 3. Install/upgrade SearXNG and its deps into the venv.
	_ = runCmd(w, l.base, l.python(), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel")
	args := []string{"-m", "pip", "install"}
	if upgrade {
		args = append(args, "--upgrade")
	}
	args = append(args, "-e", l.src)
	if err := runCmd(w, l.base, l.python(), args...); err != nil {
		return fmt.Errorf("pip install SearXNG: %w", err)
	}

	// 4. Persist a stable secret so generated settings are deterministic.
	if _, err := ensureSecret(l); err != nil {
		return err
	}
	return nil
}

// Manager is a running, supervised SearXNG instance.
type Manager struct {
	cmd    *exec.Cmd
	url    string
	mu     sync.Mutex
	closed bool
}

// URL is the base URL the agent's web_search should call.
func (m *Manager) URL() string { return m.url }

// Start launches the managed SearXNG and waits (bounded) for it to answer.
// preferredPort is used when free, otherwise a free ephemeral port is chosen.
// logw receives the instance's stdout/stderr. Returns an error (caller degrades
// to a warning) if it can't start or never becomes ready.
func Start(ctx context.Context, home, preferredPort string, logw io.Writer) (*Manager, error) {
	if !Installed(home) {
		return nil, fmt.Errorf("SearXNG is not installed")
	}
	l := layoutFor(home)
	secret, err := ensureSecret(l)
	if err != nil {
		return nil, err
	}
	port := pickPort(preferredPort)
	if err := writeSettings(l.settings, port, secret); err != nil {
		return nil, err
	}

	// `python -m searx.webapp` serves the app reading our settings.yml; the
	// DISABLE_ETC flag keeps it from touching a system-wide /etc/searxng.
	cmd := exec.Command(l.python(), "-m", "searx.webapp")
	cmd.Dir = l.src
	cmd.Env = append(os.Environ(),
		"SEARXNG_SETTINGS_PATH="+l.settings,
		"SEARXNG_DISABLE_ETC_SETTINGS=1",
	)
	cmd.Stdout = logw
	cmd.Stderr = logw
	// Own process group so Stop can tear down the whole tree — nothing lingers.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting SearXNG: %w", err)
	}
	m := &Manager{cmd: cmd, url: "http://127.0.0.1:" + port}

	if err := waitReady(ctx, cmd, m.url); err != nil {
		m.Stop()
		return nil, err
	}
	return m, nil
}

// Stop signals the instance's process group and reaps it, escalating to SIGKILL
// if it overstays. Idempotent and safe to call from teardown paths.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.cmd == nil || m.cmd.Process == nil {
		return
	}
	m.closed = true

	pgid := -m.cmd.Process.Pid
	_ = syscall.Kill(pgid, syscall.SIGTERM)
	done := make(chan struct{})
	go func() { _, _ = m.cmd.Process.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = syscall.Kill(pgid, syscall.SIGKILL)
	}
}

// --- internals ---------------------------------------------------------------

func waitReady(ctx context.Context, cmd *exec.Cmd, baseURL string) error {
	deadline := time.Now().Add(readyTimeout)
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		if cmd.ProcessState != nil { // exited during startup
			return fmt.Errorf("SearXNG exited during startup")
		}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/healthz", nil)
		if resp, err := client.Do(req); err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
	}
	return fmt.Errorf("SearXNG did not become ready within %s", readyTimeout)
}

// pickPort returns preferred when it is free, otherwise a free ephemeral port.
func pickPort(preferred string) string {
	if preferred != "" && portFree(preferred) {
		return preferred
	}
	if l, err := net.Listen("tcp", "127.0.0.1:0"); err == nil {
		defer l.Close()
		if _, p, err := net.SplitHostPort(l.Addr().String()); err == nil {
			return p
		}
	}
	return preferred
}

func portFree(port string) bool {
	l, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}

// settingsTemplate inherits SearXNG's bundled defaults (engine list etc.) and
// overrides only what we need: bind to loopback on our port, a stable secret,
// the JSON output format the agent calls, and the limiter off for local use.
const settingsTemplate = `# Generated by codeberg — regenerated on each start.
# To use your own instance instead, set CODEBERG_SEARXNG_URL and codeberg will
# not manage this file.
use_default_settings: true
general:
  instance_name: "codeberg"
  debug: false
server:
  bind_address: "127.0.0.1"
  port: %s
  secret_key: "%s"
  limiter: false
  public_instance: false
  image_proxy: false
search:
  safe_search: 0
  formats:
    - html
    - json
`

func writeSettings(path, port, secret string) error {
	body := fmt.Sprintf(settingsTemplate, port, secret)
	return os.WriteFile(path, []byte(body), 0o600)
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

func runCmd(w io.Writer, dir, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = w
	cmd.Stderr = w
	return cmd.Run()
}

func fileExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && !fi.IsDir()
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}
