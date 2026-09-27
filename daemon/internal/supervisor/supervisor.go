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
}

func Start(ctx context.Context, cfg config.Indexer) (*Supervisor, error) {
	bin, err := resolveBin(cfg.Bin)
	if err != nil {
		return nil, err
	}
	s := &Supervisor{cfg: cfg}
	if err := s.spawn(ctx, bin); err != nil {
		return nil, err
	}
	go s.watch(ctx, bin)
	return s, nil
}

func (s *Supervisor) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Signal(os.Interrupt)
	}
}

func (s *Supervisor) spawn(ctx context.Context, bin string) error {
	cmd := exec.CommandContext(ctx, bin)
	out := io.Writer(os.Stderr)
	if dir := os.Getenv("CODEBERG_LOG_DIR"); dir != "" {
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
	cmd.Env = append(os.Environ(), indexerEnv(s.cfg)...)

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

func indexerEnv(cfg config.Indexer) []string {
	env := []string{
		config.EnvRoot + "=" + cfg.Root,
		config.EnvSocket + "=" + cfg.Socket,
		fmt.Sprintf("%s=%d", config.EnvPollMS, cfg.PollMS),
	}

	// Multi-root mode: hand the engine the full key\tpath record set (it
	// prefers CODEBERG_ROOTS; the single CODEBERG_ROOT above is the fallback).
	if len(cfg.Roots) > 1 || (len(cfg.Roots) == 1 && cfg.DefaultKey == "") {
		env = append(env, config.EnvRoots+"="+config.FormatRoots(cfg.Roots))
	}

	if cfg.Model != "" {
		env = append(env, config.EnvModel+"="+cfg.Model)
	}
	for key, value := range map[string]string{
		config.EnvEmbedBackend: cfg.EmbedBackend,
		config.EnvEmbedWorker:  cfg.EmbedWorker,
		config.EnvEmbedPython:  cfg.EmbedPython,
		config.EnvLlamaServer:  cfg.LlamaServer,
	} {
		if value != "" {
			env = append(env, key+"="+value)
		}
	}
	if cfg.Index != "" {
		env = append(env, config.EnvIndexPath+"="+cfg.Index)
	}
	if cfg.IndexBackend != "" {
		env = append(env, config.EnvIndexBackend+"="+cfg.IndexBackend)
	}
	if cfg.IndexQuant != "" {
		env = append(env, config.EnvIndexQuant+"="+cfg.IndexQuant)
	}
	if cfg.VectorDBURL != "" {
		env = append(env, config.EnvVectorDBURL+"="+cfg.VectorDBURL)
	}
	if cfg.VectorDBKey != "" {
		env = append(env, config.EnvVectorDBKey+"="+cfg.VectorDBKey)
	}
	if cfg.PostgresURL != "" {
		env = append(env, config.EnvPostgresURL+"="+cfg.PostgresURL)
	}

	return env
}

func (s *Supervisor) watch(ctx context.Context, bin string) {
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
