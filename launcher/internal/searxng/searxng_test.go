package searxng

import (
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstalledFalseOnEmptyHome(t *testing.T) {
	if Installed(t.TempDir()) {
		t.Fatal("a fresh home should not report SearXNG installed")
	}
}

func TestEnsureSecretPersists(t *testing.T) {
	l := layoutFor(t.TempDir())
	s1, err := ensureSecret(l)
	if err != nil {
		t.Fatal(err)
	}
	if len(s1) < 16 {
		t.Fatalf("secret too short: %q", s1)
	}
	s2, err := ensureSecret(l)
	if err != nil {
		t.Fatal(err)
	}
	if s1 != s2 {
		t.Fatalf("secret should persist across calls: %q != %q", s1, s2)
	}
}

func TestWriteSettingsHasPortSecretAndJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.yml")
	if err := writeSettings(path, "48089", "deadbeef"); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	for _, want := range []string{
		"port: 48089",
		`secret_key: "deadbeef"`,
		`bind_address: "127.0.0.1"`,
		"- json", // the agent calls the JSON API
		"limiter: false",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("settings.yml missing %q:\n%s", want, got)
		}
	}
}

func TestPortFreeDetectsTakenPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	_, port, _ := net.SplitHostPort(ln.Addr().String())
	if portFree(port) {
		t.Fatalf("port %s is held by the test, should not report free", port)
	}
}

func TestPickPortFallsBackToEphemeral(t *testing.T) {
	// An empty preferred port forces the ephemeral path; it must return a port.
	if got := pickPort(""); got == "" {
		t.Fatal("pickPort(\"\") returned empty")
	}
}
