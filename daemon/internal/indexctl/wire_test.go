package indexctl

import "testing"

func TestEncodeSearchWithFilters(t *testing.T) {
	line := encodeSearch(SearchOptions{
		Query:    "auth",
		K:        5,
		Repo:     "alpha",
		PathGlob: "daemon/*",
		Kind:     "function",
		MinScore: 0.75,
	})
	want := "search\tauth\t5\talpha\tdaemon/*\tfunction\t0.750000\n"
	if line+"\n" != want {
		t.Fatalf("encodeSearch filters: got %q want %q", line+"\n", want)
	}
}

func TestEncodeSearchRepoOnly(t *testing.T) {
	line := encodeSearch(SearchOptions{Query: "q", K: 3, Repo: "beta"})
	if line != "search\tq\t3\tbeta" {
		t.Fatalf("repo-only wire: %q", line)
	}
}

func TestEncodeChunk(t *testing.T) {
	if got := encodeChunk("main", 42); got != "chunk\tmain\t42" {
		t.Fatalf("encodeChunk: %q", got)
	}
}

func TestEncodeSymbol(t *testing.T) {
	line := encodeSymbol(SymbolOptions{Name: "Add", Repo: "alpha", Kind: "function", Limit: 0})
	if line != "symbol\tAdd\talpha\tfunction\t20" {
		t.Fatalf("encodeSymbol: %q", line)
	}
}

func TestEncodeOutline(t *testing.T) {
	if got := encodeOutline("beta", "src/main.go"); got != "outline\tbeta\tsrc/main.go" {
		t.Fatalf("encodeOutline: %q", got)
	}
}

func TestEncodeSearchGraph(t *testing.T) {
	line := encodeSearchGraph(GraphSearchOptions{Name: "helper", Repo: "main", Kind: "function", Limit: 10})
	if line != "search_graph\thelper\tmain\tfunction\t\t10" {
		t.Fatalf("encodeSearchGraph: %q", line)
	}
}

func TestEncodeTracePath(t *testing.T) {
	line := encodeTracePath(TracePathOptions{Name: "helper", Direction: "in", EdgeKind: "calls", MaxDepth: 2, Limit: 32})
	if line != "trace_path\thelper\t\tin\tcalls\t2\t32\t" {
		t.Fatalf("encodeTracePath: %q", line)
	}
	line = encodeTracePath(TracePathOptions{Name: "helper", Repo: "main", PathPrefix: "a.go", Direction: "both", EdgeKind: "calls", MaxDepth: 1, Limit: 16})
	if line != "trace_path\thelper\tmain\tboth\tcalls\t1\t16\ta.go" {
		t.Fatalf("encodeTracePath path: %q", line)
	}
}

func TestEncodeGraphStats(t *testing.T) {
	if got := encodeGraphStats(""); got != "graph_stats" {
		t.Fatalf("encodeGraphStats empty: %q", got)
	}
	if got := encodeGraphStats("alpha"); got != "graph_stats\talpha" {
		t.Fatalf("encodeGraphStats repo: %q", got)
	}
}

func TestEncodeGraphHubs(t *testing.T) {
	if got := encodeGraphHubs(GraphHubsOptions{Limit: 5}); got != "graph_hubs\t\t5" {
		t.Fatalf("encodeGraphHubs empty repo: %q", got)
	}
	if got := encodeGraphHubs(GraphHubsOptions{Repo: "main", Limit: 0}); got != "graph_hubs\tmain\t10" {
		t.Fatalf("encodeGraphHubs default limit: %q", got)
	}
}
