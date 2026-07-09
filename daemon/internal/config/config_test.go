package config

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDaemonRequiresRoot(t *testing.T) {
	t.Setenv(EnvRoot, "")
	t.Setenv(EnvRoots, "")
	_, err := LoadDaemon()
	if err == nil {
		t.Fatal("expected error without CODEBERG_ROOT")
	}
	var cfgErr *Error
	if !errors.As(err, &cfgErr) || cfgErr.Var != EnvRoot {
		t.Fatalf("got %v", err)
	}
}

func TestLoadDaemonDefaults(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvRoot, root)
	t.Setenv(EnvRoots, "")
	t.Setenv(EnvHTTPPort, "")
	t.Setenv(EnvSocket, "")
	t.Setenv(EnvPollMS, "")
	t.Setenv(EnvGitPullSec, "")
	t.Setenv(EnvGitDir, "")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}
	wantRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Root != wantRoot {
		t.Fatalf("root: got %q want %q", cfg.Root, wantRoot)
	}
	if len(cfg.Roots) != 1 || cfg.Roots[0].Root != wantRoot {
		t.Fatalf("roots: got %+v", cfg.Roots)
	}
	if want := filepath.Base(wantRoot); cfg.DefaultKey != want || cfg.Roots[0].Key != want {
		t.Fatalf("default key: got %q / %q want %q", cfg.DefaultKey, cfg.Roots[0].Key, want)
	}
	if cfg.HTTPPort != "8080" {
		t.Fatalf("port: got %q", cfg.HTTPPort)
	}
	if cfg.Socket != "/tmp/codeberg-index.sock" {
		t.Fatalf("socket: got %q", cfg.Socket)
	}
	if cfg.PollMS != 1000 {
		t.Fatalf("poll: got %d", cfg.PollMS)
	}
	if len(cfg.GitDirs) != 1 || cfg.GitDirs[0] != cfg.Root {
		t.Fatalf("git dirs should default to the roots, got %v", cfg.GitDirs)
	}
}

func TestLoadDaemonMultiRoots(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	t.Setenv(EnvRoot, "")
	t.Setenv(EnvRoots, "alpha\t"+rootA+"\nbeta\t"+rootB+"\ndead\t/cberg/definitely/missing\nmalformed-no-tab")
	t.Setenv(EnvGitDir, "")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Roots) != 2 {
		t.Fatalf("roots: got %+v, want dead+malformed skipped", cfg.Roots)
	}
	if cfg.Roots[0].Key != "alpha" || cfg.Roots[1].Key != "beta" {
		t.Fatalf("keys: got %+v", cfg.Roots)
	}
	if cfg.DefaultKey != "" {
		t.Fatalf("multi-root mode must have no default repo, got %q", cfg.DefaultKey)
	}
	if cfg.Root != cfg.Roots[0].Root {
		t.Fatalf("Root should be the first root, got %q", cfg.Root)
	}
	if len(cfg.GitDirs) != 2 {
		t.Fatalf("git dirs should cover all roots, got %v", cfg.GitDirs)
	}
}

func TestLoadDaemonAllRootsDead(t *testing.T) {
	t.Setenv(EnvRoot, "")
	t.Setenv(EnvRoots, "dead\t/cberg/definitely/missing")

	_, err := LoadDaemon()
	var cfgErr *Error
	if !errors.As(err, &cfgErr) || cfgErr.Var != EnvRoots {
		t.Fatalf("expected invalid %s, got %v", EnvRoots, err)
	}
}

func TestLoadDaemonCommaSeparatedRoot(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	t.Setenv(EnvRoot, rootA+","+rootB)
	t.Setenv(EnvRoots, "")
	t.Setenv(EnvGitDir, "")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Roots) != 2 {
		t.Fatalf("roots: got %+v", cfg.Roots)
	}
	if cfg.DefaultKey != "" {
		t.Fatalf("multi-root mode must have no default repo, got %q", cfg.DefaultKey)
	}
}

func TestLoadDaemonPollClamp(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvRoot, root)
	t.Setenv(EnvRoots, "")
	t.Setenv(EnvPollMS, "0")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PollMS != 1000 {
		t.Fatalf("poll clamp: got %d", cfg.PollMS)
	}
}

func TestLoadDaemonGitPull(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvRoot, root)
	t.Setenv(EnvRoots, "")
	t.Setenv(EnvGitPullSec, "120")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GitPull != 120*time.Second {
		t.Fatalf("git pull: got %v", cfg.GitPull)
	}
}

func TestLoadDaemonIndexQuant(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvRoot, root)
	t.Setenv(EnvRoots, "")
	t.Setenv(EnvHTTPPort, "")
	t.Setenv(EnvSocket, "")
	t.Setenv(EnvPollMS, "")
	t.Setenv(EnvGitPullSec, "")
	t.Setenv(EnvGitDir, "")
	t.Setenv(EnvIndexQuant, "F32")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.IndexQuant != "F32" {
		t.Fatalf("index quant: got %q want %q", cfg.IndexQuant, "F32")
	}
}
