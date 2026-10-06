package projects

import (
	"fmt"
	"net/http"
	"time"
)

func (m *Manager) BindDefault(handler http.Handler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runtimes[m.catalog.DefaultID] = runtime{handler: handler, stop: func() {}, started: time.Now()}
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
		return nil, fmt.Errorf("unknown project")
	}

	handler, stop, err := m.start(p, m.projectConfig(p))
	if err != nil {
		return nil, err
	}

	m.runtimes[id] = runtime{handler: handler, stop: stop, started: time.Now()}
	return handler, nil
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true

	for _, rt := range m.runtimes {
		rt.stop()
	}
}

func (m *Manager) WithGitPull(interval time.Duration) *Manager {
	m.gitPull = interval
	return m
}
