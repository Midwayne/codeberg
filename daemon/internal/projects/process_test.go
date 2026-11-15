package projects

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"codeberg.org/codeberg/daemon/internal/supervisor"
)

type fakeProcess struct {
	state   supervisor.State
	retries []bool
}

func (p *fakeProcess) State() supervisor.State { return p.state }

func (p *fakeProcess) Retry(force bool) { p.retries = append(p.retries, force) }

func unreachable(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(503)
	_, _ = w.Write([]byte(`{"message":"indexer unavailable"}`))
}

func request(m *Manager, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	m.Handler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest(method, path, nil))

	return w
}

func TestHealthReportsWhyAnIndexerKeepsStopping(t *testing.T) {
	m, _ := setup(t)
	p := m.catalog.Projects[0]
	process := &fakeProcess{state: supervisor.State{Failures: 1, LastError: "exit status 1: bootstrap: I/O error", LogPath: "/logs/indexer.log"}}
	m.BindDefault(Supervised(http.HandlerFunc(unreachable), process))

	// One exit is a restart in progress, not yet something to alarm the user with.
	if w := request(m, "GET", "/projects/"+p.ID+"/health"); w.Code != 200 || !strings.Contains(w.Body.String(), `"indexing"`) {
		t.Fatalf("single restart = %d %s, want indexing", w.Code, w.Body)
	}

	process.state.Failures = crashLoopFailures
	w := request(m, "GET", "/projects/"+p.ID+"/health")

	if w.Code != 503 {
		t.Fatalf("crash loop = %d %s, want 503", w.Code, w.Body)
	}
	for _, want := range []string{"bootstrap: I/O error", "/logs/indexer.log"} {
		if !strings.Contains(w.Body.String(), want) {
			t.Fatalf("crash loop message %s lacks %q", w.Body, want)
		}
	}
}

func TestRetryRestartsTheIndexer(t *testing.T) {
	t.Setenv("CODEBERG_HEALTH_TIMEOUT", "1h")

	m, _ := setup(t)
	p := m.catalog.Projects[0]
	process := &fakeProcess{}
	m.BindDefault(Supervised(http.HandlerFunc(unreachable), process))

	if w := request(m, "POST", "/projects/"+p.ID+"/retry"); w.Code != 200 {
		t.Fatalf("retry = %d %s", w.Code, w.Body)
	}
	if len(process.retries) != 1 || process.retries[0] {
		t.Fatalf("retries = %v, want one unforced retry while the indexer may still be starting", process.retries)
	}

	// Past the startup deadline an indexer that still does not answer is replaced.
	rt := m.runtimes[p.ID]
	rt.started = time.Now().Add(-2 * time.Hour)
	m.runtimes[p.ID] = rt

	if w := request(m, "POST", "/projects/"+p.ID+"/retry"); w.Code != 200 {
		t.Fatalf("retry = %d %s", w.Code, w.Body)
	}
	if len(process.retries) != 2 || !process.retries[1] {
		t.Fatalf("retries = %v, want a forced retry for an unresponsive indexer", process.retries)
	}
	if time.Since(m.runtimes[p.ID].started) > time.Minute {
		t.Fatal("retry did not restart the startup deadline")
	}
}
