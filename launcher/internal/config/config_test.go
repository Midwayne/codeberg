package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/launcher/internal/registry"
)

// writeArtifacts lays out a minimal dist/checkout tree under root so ResolveRoot
// sees all three required artifacts.
func writeArtifacts(t *testing.T, root string) {
	t.Helper()
	a := LocateArtifacts(root)
	for _, p := range []string{a.DaemonBin, a.IndexBin, a.TUIScript} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func TestResolveRootPrefersPopulatedDist(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)

	c := &Config{Dist: dist, Repo: "/some/checkout"}
	root, prebuilt := c.ResolveRoot()
	if !prebuilt || root != dist {
		t.Fatalf("ResolveRoot() = (%q, %v); want (%q, true)", root, prebuilt, dist)
	}
}

func TestResolveRootFallsBackToRepoWhenDistIncomplete(t *testing.T) {
	dist := t.TempDir() // exists but empty -> not a usable dist
	c := &Config{Dist: dist, Repo: "/some/checkout"}
	root, prebuilt := c.ResolveRoot()
	if prebuilt || root != "/some/checkout" {
		t.Fatalf("ResolveRoot() = (%q, %v); want (\"/some/checkout\", false)", root, prebuilt)
	}
}

func TestAllResolution(t *testing.T) {
	home := t.TempDir()

	// Default off.
	c, err := Load(Overrides{Home: home, ConfigFile: filepath.Join(home, "config")})
	if err != nil {
		t.Fatal(err)
	}
	if c.All {
		t.Fatal("All should default to false")
	}

	// Env turns it on; the CLI flag wins over env.
	t.Setenv(KeyAll, "true")
	c, err = Load(Overrides{Home: home, ConfigFile: filepath.Join(home, "config")})
	if err != nil {
		t.Fatal(err)
	}
	if !c.All {
		t.Fatal("CODEBERG_ALL=true should enable All")
	}
	off := false
	c, err = Load(Overrides{Home: home, ConfigFile: filepath.Join(home, "config"), All: &off})
	if err != nil {
		t.Fatal(err)
	}
	if c.All {
		t.Fatal("CLI --all=false should beat env")
	}
}

func TestValidateForRunAllSkipsRoot(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)
	c := &Config{Dist: dist, Model: "anthropic:claude", All: true}
	if err := c.ValidateForRun(); err != nil {
		t.Fatalf("--all must not require a root: %v", err)
	}
}

func TestDaemonEnvRoots(t *testing.T) {
	c := &Config{
		Root:     "/one",
		HTTPPort: "48080",
		Socket:   "/tmp/s.sock",
		Roots:    []registry.Entry{{Key: "alpha", Root: "/one"}, {Key: "beta", Root: "/two"}},
		All:      true,
	}
	e := c.DaemonEnv()
	if got, want := e[KeyRoots], "alpha\t/one\nbeta\t/two"; got != want {
		t.Fatalf("roots env: got %q want %q", got, want)
	}
	if _, ok := e[KeyRoot]; ok {
		t.Fatal("--all must not pin a single CODEBERG_ROOT")
	}

	c.All = false
	c.Roots = c.Roots[:1]
	e = c.DaemonEnv()
	if e[KeyRoot] != "/one" {
		t.Fatalf("single-root mode should keep CODEBERG_ROOT, got %q", e[KeyRoot])
	}
	if e[KeyRoots] != "alpha\t/one" {
		t.Fatalf("single-root mode should still send the keyed record, got %q", e[KeyRoots])
	}
}

func TestNoIndexForcesVectorOff(t *testing.T) {
	home := t.TempDir()
	on := true
	c, err := Load(Overrides{Home: home, ConfigFile: filepath.Join(home, "config"), NoIndex: &on})
	if err != nil {
		t.Fatal(err)
	}
	if !c.NoIndex {
		t.Fatal("NoIndex not set")
	}
	if c.Vector {
		t.Fatal("--no-index must disable vector indexing for the run")
	}
}

func TestReposSelectionParsing(t *testing.T) {
	home := t.TempDir()
	c, err := Load(Overrides{Home: home, ConfigFile: filepath.Join(home, "config"), Repos: " a , b ,,c "})
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Repos) != 3 || c.Repos[0] != "a" || c.Repos[2] != "c" {
		t.Fatalf("repos parse: %+v", c.Repos)
	}

	// --repos mode must not pin a single CODEBERG_ROOT in the daemon env.
	c.Roots = []registry.Entry{{Key: "a", Root: "/a"}, {Key: "c", Root: "/c"}}
	c.Root = "/from-config-file"
	c.HTTPPort, c.Socket = "48080", "/tmp/s.sock"
	e := c.DaemonEnv()
	if _, ok := e[KeyRoot]; ok {
		t.Fatal("--repos must not send CODEBERG_ROOT")
	}
	if e[KeyRoots] != "a\t/a\nc\t/c" {
		t.Fatalf("roots records: %q", e[KeyRoots])
	}
}

func TestValidateForRunReposSkipsRoot(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)
	c := &Config{Dist: dist, Model: "anthropic:claude", Repos: []string{"a"}}
	if err := c.ValidateForRun(); err != nil {
		t.Fatalf("--repos must not require a root when CODEBERG_ROOT is unset: %v", err)
	}
}

func TestValidateForRunRejectsRootWithAll(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)
	root := t.TempDir()
	c := &Config{Dist: dist, Model: "anthropic:claude", Root: root, All: true}
	if err := c.ValidateForRun(); err == nil {
		t.Fatal("CODEBERG_ROOT + --all must be rejected")
	}
}

func TestValidateForRunRejectsRootWithRepos(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)
	root := t.TempDir()
	c := &Config{Dist: dist, Model: "anthropic:claude", Root: root, Repos: []string{"a"}}
	if err := c.ValidateForRun(); err == nil {
		t.Fatal("CODEBERG_ROOT + --repos must be rejected")
	}
}

func TestValidateForRunRejectsEmptyRootList(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)
	c := &Config{Dist: dist, Model: "anthropic:claude", Root: ",,"}
	if err := c.ValidateForRun(); err == nil {
		t.Fatal("malformed CODEBERG_ROOT must be rejected")
	}
}

func TestValidateForRunRejectsInvalidPathInList(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)
	good := t.TempDir()
	c := &Config{Dist: dist, Model: "anthropic:claude", Root: good + ",/definitely/not/a/dir"}
	if err := c.ValidateForRun(); err == nil {
		t.Fatal("invalid path in comma-separated CODEBERG_ROOT must be rejected")
	}
}

func TestDaemonEnvMultiRootOmitsSingleRootEnv(t *testing.T) {
	c := &Config{
		Root:     "/one,/two",
		HTTPPort: "48080",
		Socket:   "/tmp/s.sock",
		Roots: []registry.Entry{
			{Key: "one", Root: "/one"},
			{Key: "two", Root: "/two"},
		},
	}
	e := c.DaemonEnv()
	if _, ok := e[KeyRoot]; ok {
		t.Fatal("multi-path CODEBERG_ROOT must not set CODEBERG_ROOT env")
	}
	if e[KeyRoots] != "one\t/one\ntwo\t/two" {
		t.Fatalf("roots records: %q", e[KeyRoots])
	}
}

func TestInitFileWritesEmbeddedExample(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	created, err := InitFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("InitFile should create a new file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	for _, want := range []string{
		"CODEBERG_ROOT=",
		"CODEBERG_MODEL=",
		"config.example",
		"docs/multi-repo.md",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("init template missing %q", want)
		}
	}
	if strings.Contains(body, "CODEBERG_HEALTH_TIMEOUT") {
		t.Fatal("init template should be minimal, not the full config.example")
	}
	again, err := InitFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if again {
		t.Fatal("InitFile must not overwrite an existing file")
	}
}
