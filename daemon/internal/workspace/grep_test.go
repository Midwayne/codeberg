package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGrepBoundsMinifiedLines(t *testing.T) {
	root := t.TempDir()
	line := "needle" + strings.Repeat("x", 5*1024*1024)

	if err := os.WriteFile(filepath.Join(root, "bundle.min.js"), []byte(line+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("// needle\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	hits, err := w.Grep(context.Background(), "needle", true, "main", "", 10)
	if err != nil {
		t.Fatalf("a multi-megabyte line must not fail the whole grep: %v", err)
	}

	if len(hits) != 2 {
		t.Fatalf("want both files, got %+v", hits)
	}

	for _, hit := range hits {
		if len(hit.Text) > 2*grepMaxColumns {
			t.Fatalf("%s: line text not bounded: %d bytes", hit.Path, len(hit.Text))
		}

		if !strings.Contains(hit.Text, "needle") {
			t.Fatalf("%s: preview lost the match: %q", hit.Path, hit.Text)
		}
	}
}

func TestGrepStopsAtLimit(t *testing.T) {
	root := writeMatchingTree(t, 20, 500)
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	hits, err := w.Grep(context.Background(), "match", true, "main", "", 7)
	if err != nil {
		t.Fatal(err)
	}

	if len(hits) != 7 {
		t.Fatalf("want exactly the limit, got %d", len(hits))
	}

	for _, hit := range hits {
		if hit.Repo != "main" || hit.Line == 0 || !strings.Contains(hit.Text, "match") {
			t.Fatalf("malformed hit: %+v", hit)
		}
	}
}

func TestGrepNoMatchesIsEmpty(t *testing.T) {
	root := writeMatchingTree(t, 2, 5)
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	hits, err := w.Grep(context.Background(), "absent-token", true, "main", "", 10)
	if err != nil || len(hits) != 0 {
		t.Fatalf("want no hits and no error, got %+v, %v", hits, err)
	}
}

func TestGrepReportsInvalidPattern(t *testing.T) {
	root := writeMatchingTree(t, 1, 1)
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	if _, err := w.Grep(context.Background(), "(unclosed", false, "main", "", 10); err == nil {
		t.Fatal("an invalid regex must surface as an error")
	}
}

// BenchmarkGrepBroadPattern models an agent grepping a common token in a large
// tree: far more matching lines exist than the result limit returns.
func BenchmarkGrepBroadPattern(b *testing.B) {
	root := writeMatchingTree(b, 400, 2000)
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		hits, err := w.Grep(context.Background(), "match", true, "main", "", defaultMaxMatches)
		if err != nil || len(hits) != defaultMaxMatches {
			b.Fatalf("got %d hits, %v", len(hits), err)
		}
	}
}

func writeMatchingTree(tb testing.TB, files, lines int) string {
	tb.Helper()

	root := tb.TempDir()
	body := strings.Repeat("a line that will match the broad pattern\n", lines)

	for i := 0; i < files; i++ {
		path := filepath.Join(root, fmt.Sprintf("file_%03d.txt", i))
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			tb.Fatal(err)
		}
	}

	return root
}
