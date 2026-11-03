package tools

import (
	"context"
	"errors"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

func TestBlastRadiusRetainsIdenticalSymbolsInOtherRepositories(t *testing.T) {
	scan := changeScan{
		seenDirect: map[string]struct{}{}, seenIndirect: map[string]struct{}{},
	}
	hops := []indexctl.GraphHop{{
		SrcRepo: "api", SrcName: "Save", SrcPath: "main.go",
		DstRepo: "storage", DstName: "Save", DstPath: "main.go",
	}}

	scan.addHops(hops, pendingTrace{repo: "storage", name: "Save", path: "main.go"}, 10)
	if len(scan.res.Indirect) != 1 || scan.res.Indirect[0].Repo != "api" {
		t.Fatalf("the foreign caller must survive same-name/path deduplication: %+v", scan.res.Indirect)
	}
}

type scopedImpactIndexer struct {
	*mockIndexer
}

func (m *scopedImpactIndexer) TracePath(_ context.Context, opts indexctl.TracePathOptions) ([]indexctl.GraphHop, error) {
	m.lastTrace = opts
	if opts.Repo == "" {
		return nil, errors.New("ambiguous trace start across repositories")
	}

	return []indexctl.GraphHop{{
		SrcRepo: "api", SrcName: "Save", SrcPath: "main.go",
		DstRepo: "storage", DstName: "Save", DstPath: "main.go",
	}}, nil
}

func TestBlastRadiusTracesResolvedRepositoryWhenRequestUsesDefault(t *testing.T) {
	scan := changeScan{
		seenDirect: map[string]struct{}{}, seenIndirect: map[string]struct{}{},
		traces: []pendingTrace{{repo: "api", name: "Save", path: "main.go"}},
	}
	idx := &scopedImpactIndexer{&mockIndexer{}}

	scan.collectIndirect(context.Background(), idx, 1, 10)

	if idx.lastTrace.Repo != "api" || len(scan.res.Indirect) != 1 || scan.res.Indirect[0].Repo != "storage" {
		t.Fatalf("resolved source scope must prevent cross-root ambiguity and retain impact: trace=%+v, indirect=%+v", idx.lastTrace, scan.res.Indirect)
	}
}
