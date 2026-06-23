package supervisor

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
)

type Supervisor struct {
	cfg    config.Indexer
	cmd    *exec.Cmd
	mu     sync.Mutex
	closed bool
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
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	cmd.Env = append(os.Environ(),
		config.EnvRoot+"="+s.cfg.Root,
		config.EnvSocket+"="+s.cfg.Socket,
		fmt.Sprintf("%s=%d", config.EnvPollMS, s.cfg.PollMS),
	)
	if s.cfg.Model != "" {
		cmd.Env = append(cmd.Env, config.EnvModel+"="+s.cfg.Model)
	}
	if s.cfg.Index != "" {
		cmd.Env = append(cmd.Env, config.EnvIndexPath+"="+s.cfg.Index)
	}
	s.cmd = cmd
	return cmd.Start()
}

func (s *Supervisor) watch(ctx context.Context, bin string) {
	backoff := time.Second
	for {
		err := s.cmd.Wait()
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
