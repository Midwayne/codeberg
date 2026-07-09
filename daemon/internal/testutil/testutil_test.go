package testutil_test

import (
	"context"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/testutil"
)

func TestFakeIndexerReportsNotReady(t *testing.T) {
	idx := &testutil.FakeIndexer{}
	st, err := idx.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.Ready {
		t.Fatal("zero FakeIndexer must not silently report ready")
	}

	idx = idx.WithStatus(indexctl.Status{Ready: false, Version: "v0"})
	st, err = idx.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if st.Ready || st.Version != "v0" {
		t.Fatalf("explicit not-ready lost: %+v", st)
	}

	ready := testutil.StubIndexer()
	st, err = ready.Status(context.Background())
	if err != nil || !st.Ready {
		t.Fatalf("StubIndexer should be ready: %+v %v", st, err)
	}
}
