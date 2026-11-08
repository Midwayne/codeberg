package config

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDaemonWithoutRoots(t *testing.T) {
	t.Setenv("CODEBERG_ROOT", "/missing/obsolete/root")
	t.Setenv(EnvRoots, "")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatalf("empty startup must be allowed: %v", err)
	}

	if cfg.DefaultKey != "" || len(cfg.Roots) != 0 {
		t.Fatalf("unexpected startup repository: %#v", cfg.Indexer)
	}
}

func TestLoadDaemonDefaults(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvRoots, filepath.Base(root)+"\t"+root)
	t.Setenv(EnvHTTPPort, "")
	t.Setenv(EnvPollMS, "")
	t.Setenv(EnvGitPullSec, "")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}

	wantRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}

	if len(cfg.Roots) != 1 || cfg.Roots[0].Root != wantRoot {
		t.Fatalf("roots: got %+v", cfg.Roots)
	}

	if want := filepath.Base(wantRoot); cfg.DefaultKey != want || cfg.Roots[0].Key != want {
		t.Fatalf("default key: got %q / %q want %q", cfg.DefaultKey, cfg.Roots[0].Key, want)
	}

	if cfg.HTTPPort != "48080" {
		t.Fatalf("port: got %q", cfg.HTTPPort)
	}

	if cfg.PollMS != 1000 {
		t.Fatalf("poll: got %d", cfg.PollMS)
	}
}

func TestLoadDaemonMultiRoots(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	t.Setenv(EnvRoots, "alpha\t"+rootA+"\nbeta\t"+rootB+"\ndead\t/cberg/definitely/missing\nmalformed-no-tab")

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
}

func TestLoadDaemonAllRootsDead(t *testing.T) {
	t.Setenv(EnvRoots, "dead\t/cberg/definitely/missing")

	_, err := LoadDaemon()
	var cfgErr *Error
	if !errors.As(err, &cfgErr) || cfgErr.Var != EnvRoots {
		t.Fatalf("expected invalid %s, got %v", EnvRoots, err)
	}
}

func TestLoadDaemonPollClamp(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvRoots, filepath.Base(root)+"\t"+root)
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
	t.Setenv(EnvRoots, filepath.Base(root)+"\t"+root)
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
	t.Setenv(EnvRoots, filepath.Base(root)+"\t"+root)
	t.Setenv(EnvHTTPPort, "")
	t.Setenv(EnvPollMS, "")
	t.Setenv(EnvGitPullSec, "")
	t.Setenv(EnvIndexQuant, "F32")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.IndexQuant != "F32" {
		t.Fatalf("index quant: got %q want %q", cfg.IndexQuant, "F32")
	}
}
