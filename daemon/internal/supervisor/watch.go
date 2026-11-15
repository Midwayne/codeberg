package supervisor

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"
)

const (
	initialBackoff = time.Second
	maxBackoff     = 30 * time.Second

	// A run this long ends a failure streak: the indexer was working, so its
	// next exit is a new problem rather than the same one repeating.
	stableRun = 30 * time.Second

	// How long a replaced indexer gets to save its state before it is killed.
	replaceGrace = 5 * time.Second
)

// State describes how the supervised indexer is doing.
type State struct {
	// Failures counts consecutive exits without a stable run in between.
	Failures int
	// LastError is the most recent exit and the indexer's last output line.
	LastError string
	// LogPath is the indexer log, when one is being written.
	LogPath string
}

func (s *Supervisor) State() State {
	s.mu.Lock()
	defer s.mu.Unlock()

	return State{Failures: s.failures, LastError: s.lastError, LogPath: s.logPath}
}

// Retry forgets the failure streak and restarts a stopped indexer immediately
// instead of waiting out its backoff. A running indexer is left alone unless
// force is set, which replaces one that no longer answers.
func (s *Supervisor) Retry(force bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return
	}

	s.failures, s.lastError, s.backoff = 0, "", initialBackoff

	select {
	case s.wake <- struct{}{}:
	default:
	}

	if !force || !s.alive || s.cmd == nil || s.cmd.Process == nil {
		return
	}

	s.replacing = true
	cmd := s.cmd
	_ = cmd.Process.Signal(os.Interrupt)

	time.AfterFunc(replaceGrace, func() {
		s.mu.Lock()
		defer s.mu.Unlock()

		if s.alive && s.cmd == cmd {
			_ = cmd.Process.Kill()
		}
	})
}

func (s *Supervisor) watch(ctx context.Context, bin string) {
	defer close(s.done)

	var err error
	for running := true; ; running = err == nil {
		if running {
			err = s.cmd.Wait()
			s.closeLog()
		}

		delay, closed := s.recordExit(err)
		if closed {
			return
		}

		if delay > 0 {
			log.Printf("cberg-index exited: %v; restarting in %s", err, delay)
		}

		if !s.pause(ctx, delay) {
			return
		}

		var stopped bool
		if err, stopped = s.respawn(ctx, bin); stopped {
			return
		}

		if err != nil {
			log.Printf("cberg-index restart failed: %v", err)
		}
	}
}

// recordExit notes why the indexer stopped and returns how long to wait before
// starting it again. A requested replacement restarts at once and is not a failure.
func (s *Supervisor) recordExit(err error) (time.Duration, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.alive = false
	if s.closed {
		return 0, true
	}

	if s.replacing {
		s.replacing = false
		return 0, false
	}

	if time.Since(s.started) >= stableRun {
		s.failures, s.backoff = 0, initialBackoff
	}

	s.failures++
	s.lastError = describeExit(err, s.tail.String())

	delay := s.backoff
	s.backoff = min(s.backoff*2, maxBackoff)

	return delay, false
}

func describeExit(err error, last string) string {
	reason := "exited"
	if err != nil {
		reason = err.Error()
	}

	if last == "" {
		return reason
	}

	return fmt.Sprintf("%s: %s", reason, last)
}

// pause waits out delay, returning early on Retry and false on shutdown.
func (s *Supervisor) pause(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
	case <-s.wake:
	}

	return true
}

// respawn starts the indexer again. A start that fails is retried like any
// other exit rather than leaving the project without an indexer for good.
func (s *Supervisor) respawn(ctx context.Context, bin string) (error, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil, true
	}

	// Drop a wake-up left over from a retry that already took effect.
	select {
	case <-s.wake:
	default:
	}

	err := s.spawn(ctx, bin)
	if err == nil {
		s.alive, s.started = true, time.Now()
	}

	return err, false
}
