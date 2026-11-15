package supervisor

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
)

type Supervisor struct {
	cfg     config.Indexer
	cmd     *exec.Cmd
	logFile *os.File
	logPath string
	tail    lastLine
	mu      sync.Mutex
	closed  bool
	done    chan struct{}

	// Restart bookkeeping, guarded by mu.
	alive     bool
	started   time.Time
	failures  int
	lastError string
	backoff   time.Duration
	replacing bool
	wake      chan struct{}
}

func Start(ctx context.Context, cfg config.Indexer) (*Supervisor, error) {
	bin, err := resolveBin(cfg.Bin)
	if err != nil {
		return nil, err
	}

	s := &Supervisor{cfg: cfg, done: make(chan struct{}), wake: make(chan struct{}, 1), backoff: initialBackoff}
	if err := s.spawn(ctx, bin); err != nil {
		return nil, err
	}

	s.alive, s.started = true, time.Now()

	go s.watch(ctx, bin)
	return s, nil
}

func (s *Supervisor) spawn(ctx context.Context, bin string) error {
	cmd := exec.CommandContext(ctx, bin)
	out := io.Writer(os.Stderr)
	dir := s.cfg.LogDir
	if dir == "" {
		dir = os.Getenv("CODEBERG_LOG_DIR")
	}

	if dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("creating indexer log directory: %w", err)
		}

		f, err := os.OpenFile(filepath.Join(dir, "indexer.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return fmt.Errorf("opening indexer log: %w", err)
		}

		s.logFile = f
		s.logPath = f.Name()
		out = io.MultiWriter(os.Stderr, f)
	}

	// Remember the last line so a failure can say why, not only that it happened.
	out = io.MultiWriter(out, &s.tail)

	cmd.Stdout = out
	cmd.Stderr = out
	cmd.Env = processEnv(s.cfg)

	s.cmd = cmd
	if err := cmd.Start(); err != nil {
		s.closeLog()
		return err
	}
	return nil
}

// Wait for the process (including os/exec's output copy) before closing the log.
func (s *Supervisor) closeLog() {
	if s.logFile != nil {
		_ = s.logFile.Close()
		s.logFile = nil
	}
}

func resolveBin(override string) (string, error) {
	if override != "" {
		return override, nil
	}

	if exe, err := os.Executable(); err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "cberg-index")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	if p, err := exec.LookPath("cberg-index"); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("cberg-index binary not found (set %s)", config.EnvIndexerBin)
}
