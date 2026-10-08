package supervisor

import (
	"os"
	"time"
)

// Wait for engine shutdown (which saves sidecars) before callers delete caches.
func (s *Supervisor) Stop() {
	s.mu.Lock()
	s.closed = true
	cmd := s.cmd
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Signal(os.Interrupt)
	}
	s.mu.Unlock()

	select {
	case <-s.done:
	case <-time.After(5 * time.Second):
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-s.done
	}
}
