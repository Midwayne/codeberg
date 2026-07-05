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
