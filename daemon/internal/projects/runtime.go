package projects

import (
	"fmt"
	"net/http"
	"time"
)

// StartDefault starts the default project's indexer before the first request,
// so the workspace the user last opened is indexing by the time they look.
func (m *Manager) StartDefault() error {
	m.mu.Lock()
	id := m.catalog.DefaultID
	m.mu.Unlock()

	if id == "" {
		return nil
	}

	_, err := m.activate(id)
	return err
}

func (m *Manager) activate(id string) (http.Handler, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.closed {
		return nil, fmt.Errorf("projects are shutting down")
	}

	if rt, ok := m.runtimes[id]; ok {
		return rt.handler, nil
	}

	p, ok := m.project(id)
	if !ok {
		return nil, errProjectNotFound
	}

	handler, stop, err := m.start(p, m.projectConfig(p))
	if err != nil {
		return nil, err
	}

	m.runtimes[id] = runtime{handler: handler, stop: stop, started: time.Now()}
	return handler, nil
}

// stopRuntime stops a project's indexer; the next request starts a fresh one.
// Callers hold m.mu.
func (m *Manager) stopRuntime(id string) {
	if rt, ok := m.runtimes[id]; ok {
		rt.stop()
		delete(m.runtimes, id)
	}
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true

	for id := range m.runtimes {
		m.stopRuntime(id)
	}
}
