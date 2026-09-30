package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/resources"
	"codeberg.org/codeberg/daemon/internal/testutil"
	"codeberg.org/codeberg/daemon/internal/tools"
)

func TestResourcesServeCacheAndRegisterWithoutSampling(t *testing.T) {
	reads := 0
	collector := resources.New(resources.Options{PID: 30, Cores: 4, TotalMemory: 48000,
		ReadProcesses: func(context.Context) ([]resources.ProcessCounter, error) { reads++; return nil, nil }})
	idx := &testutil.FakeIndexer{}
	srv := New(idx, tools.Default(testutil.WsSingle(t.TempDir()), idx)).WithResources(collector)
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	res, err := http.Get(ts.URL + "/resources")
	if err != nil {
		t.Fatal(err)
	}
	var usage resources.Usage
	if err := json.NewDecoder(res.Body).Decode(&usage); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if usage.Current != nil || len(usage.History) != 0 || usage.Collector != "daemon" {
		t.Fatalf("usage: %+v", usage)
	}
	res, err = http.Post(ts.URL+"/resources/clients", "application/json", strings.NewReader(`{"pid":20}`))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusAccepted || reads != 0 {
		t.Fatalf("registration must not sample: status=%d reads=%d", res.StatusCode, reads)
	}
	res, err = http.Get(ts.URL + "/resources?after=bad")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid cursor: %d", res.StatusCode)
	}
}

func TestResourceControlIsLocalOnly(t *testing.T) {
	idx := &testutil.FakeIndexer{}
	srv := New(idx, tools.Default(testutil.WsSingle(t.TempDir()), idx)).WithResources(resources.New(resources.Options{}))
	req := httptest.NewRequest("POST", "/resources/clients", strings.NewReader(`{"pid":20}`))
	req.RemoteAddr = "203.0.113.1:1234"
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("remote registration: %d", rec.Code)
	}
}
