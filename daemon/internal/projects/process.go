package projects

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"codeberg.org/codeberg/daemon/internal/bootstrap"
	"codeberg.org/codeberg/daemon/internal/supervisor"
)

// crashLoopFailures is how many consecutive indexer exits it takes before a
// project reports failure instead of "still indexing".
const crashLoopFailures = 3

// indexerProcess is the supervised indexer behind a project runtime.
type indexerProcess interface {
	State() supervisor.State
	Retry(force bool)
}

type supervisedHandler struct {
	http.Handler
	process indexerProcess
}

// Supervised ties a project's handler to the indexer process that backs it, so
// health can explain a failing indexer and retry can restart it.
func Supervised(handler http.Handler, process indexerProcess) http.Handler {
	return supervisedHandler{Handler: handler, process: process}
}

func processOf(handler http.Handler) indexerProcess {
	if supervised, ok := handler.(supervisedHandler); ok {
		return supervised.process
	}

	return nil
}

// crashLoop reports an indexer that keeps stopping, with the reason it gave.
func crashLoop(handler http.Handler) (string, bool) {
	process := processOf(handler)
	if process == nil {
		return "", false
	}

	state := process.State()
	if state.Failures < crashLoopFailures {
		return "", false
	}

	message := fmt.Sprintf("Project indexing stopped %d times in a row", state.Failures)
	if state.LastError != "" {
		message += ": " + state.LastError
	}

	message += ". Codeberg keeps retrying automatically."
	if state.LogPath != "" {
		message += " Details: " + state.LogPath
	}

	return message, true
}

// probe asks the project's indexer for its health without letting a busy or
// missing IPC socket hold up the caller.
func probe(handler http.Handler, r *http.Request) httptestResponse {
	buffered := httptestResponse{header: make(http.Header)}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	next := r.Clone(ctx)
	next.Method = http.MethodGet
	next.URL.Path = "/health"
	handler.ServeHTTP(&buffered, next)

	return buffered
}

// overdue is true once an indexer has had its whole startup allowance.
func (m *Manager) overdue(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	rt := m.runtimes[id]
	p, _ := m.project(id)

	return !rt.started.IsZero() && time.Since(rt.started) > bootstrap.StartupTimeout(len(p.Roots))
}
