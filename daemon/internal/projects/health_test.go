package projects

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthAllowsResponsiveColdIndexPastStartupTimeout(t *testing.T) {
	t.Setenv("CODEBERG_HEALTH_TIMEOUT", "1ms")

	for _, tc := range []struct {
		name string
		code int
		body string
		want int
	}{
		{"embedding", 200, `{"ready":false,"chunks":42}`, 200},
		{"ready", 200, `{"ready":true,"chunks":42}`, 200},
		{"unreachable", 503, `{"message":"indexer unavailable"}`, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := setup(t)
			p := m.catalog.Projects[0]
			m.BindDefault(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			rt := m.runtimes[p.ID]
			rt.started = time.Now().Add(-time.Hour)
			m.runtimes[p.ID] = rt

			w := httptest.NewRecorder()
			m.Handler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("GET", "/projects/"+p.ID+"/health", nil))

			if w.Code != tc.want {
				t.Fatalf("health = %d %s, want %d", w.Code, w.Body, tc.want)
			}
			if tc.code == 200 && !strings.Contains(w.Body.String(), `"chunks":42`) {
				t.Fatalf("lost indexing progress: %s", w.Body)
			}
		})
	}
}
