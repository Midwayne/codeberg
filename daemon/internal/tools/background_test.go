package tools

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"syscall"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/search"
	"codeberg.org/codeberg/daemon/internal/testutil"
)

func TestHybridSearchWhileIndexStarts(t *testing.T) {
	for _, unavailable := range []error{
		&indexctl.IndexerError{Code: "NOT_READY", Message: "index building"},
		syscall.ENOENT,
		syscall.ECONNREFUSED,
	} {
		t.Run(unavailable.Error(), func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(root+"/exact.go", []byte("func checkoutSessionToken() {}\n"), 0o644); err != nil {
				t.Fatal(err)
			}

			idx := &testutil.FakeIndexer{SearchErr: unavailable}
			reg := Default(testutil.WsSingle(root), idx)
			out, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"checkoutSessionToken"}`))
			if err != nil {
				t.Fatal(err)
			}

			hits := out.([]search.HybridHit)
			if len(hits) != 1 || hits[0].Hit.Path != "exact.go" || hits[0].Hit.ID != 0 {
				t.Fatalf("lexical fallback: %+v", hits)
			}

			out, err = reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"missingSymbol"}`))
			if err != nil || len(out.([]search.HybridHit)) != 0 {
				t.Fatalf("empty lexical search should succeed: %v, %v", out, err)
			}
		})
	}
}

func TestFileToolsBeforeIndexerSocketExists(t *testing.T) {
	root := t.TempDir()
	socketDir, err := os.MkdirTemp("/tmp", "cberg-background-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketDir) })

	if err := os.WriteFile(root+"/exact.go", []byte("func checkoutSessionToken() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	idx := indexctl.NewClient(socketDir + "/not-started.sock")
	reg := Default(testutil.WsSingle(root), idx)
	for name, args := range map[string]string{
		"grep":            `{"pattern":"checkoutSessionToken","literal":true}`,
		"read_file":       `{"repo":"main","path":"exact.go"}`,
		"hybrid_search":   `{"query":"checkoutSessionToken"}`,
		"find_references": `{"symbol":"checkoutSessionToken"}`,
	} {
		t.Run(name, func(t *testing.T) {
			out, err := reg.Call(context.Background(), name, json.RawMessage(args))
			if err != nil {
				t.Fatal(err)
			}

			body, err := json.Marshal(out)
			if err != nil || !strings.Contains(string(body), "checkoutSessionToken") {
				t.Fatalf("expected filesystem evidence: %s, %v", body, err)
			}
		})
	}
}
