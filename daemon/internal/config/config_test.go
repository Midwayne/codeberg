package config

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadDaemonRequiresRoot(t *testing.T) {
	t.Setenv(EnvRoot, "")
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
	if cfg.HTTPPort != "8080" {
		t.Fatalf("port: got %q", cfg.HTTPPort)
	}
	if cfg.Socket != "/tmp/codeberg-index.sock" {
		t.Fatalf("socket: got %q", cfg.Socket)
	}
	if cfg.PollMS != 1000 {
		t.Fatalf("poll: got %d", cfg.PollMS)
	}
	if cfg.GitDir != cfg.Root {
		t.Fatalf("git dir should default to root")
	}
}

func TestLoadDaemonPollClamp(t *testing.T) {
	root := t.TempDir()
	t.Setenv(EnvRoot, root)
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
	t.Setenv(EnvGitPullSec, "120")

	cfg, err := LoadDaemon()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.GitPull != 120*time.Second {
		t.Fatalf("git pull: got %v", cfg.GitPull)
	}
}

