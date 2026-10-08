package supervisor

import (
	"context"
	"fmt"
	"io"
	"log"
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
	mu      sync.Mutex
	closed  bool
	done    chan struct{}
}

func Start(ctx context.Context, cfg config.Indexer) (*Supervisor, error) {
	bin, err := resolveBin(cfg.Bin)
	if err != nil {
		return nil, err
	}

	s := &Supervisor{cfg: cfg, done: make(chan struct{})}
	if err := s.spawn(ctx, bin); err != nil {
		return nil, err
	}

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
		out = io.MultiWriter(os.Stderr, f)
	}

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

func (s *Supervisor) watch(ctx context.Context, bin string) {
	defer close(s.done)
	backoff := time.Second

	for {
		err := s.cmd.Wait()
		s.closeLog()
		s.mu.Lock()

		if s.closed {
			s.mu.Unlock()
			return
		}

		s.mu.Unlock()

		log.Printf("cberg-index exited: %v; restarting in %s", err, backoff)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		if backoff < 30*time.Second {
			backoff *= 2
		}

		s.mu.Lock()

		if s.closed {
			s.mu.Unlock()
			return
		}

		if spawnErr := s.spawn(ctx, bin); spawnErr != nil {
			s.mu.Unlock()
			log.Printf("cberg-index restart failed: %v", spawnErr)
			return
		}

		s.mu.Unlock()
		backoff = time.Second
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
