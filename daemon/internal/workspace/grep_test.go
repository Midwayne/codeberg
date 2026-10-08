package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func grepFixture(t testing.TB, lines int) *Workspace {
	t.Helper()

	root := t.TempDir()
	body := strings.Repeat("needle "+strings.Repeat("x", 200)+"\n", lines)

	if err := os.WriteFile(root+"/big.txt", []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	return New([]RepoInfo{{Key: "main", Root: root}}, "main")
}

func TestGrepStopsAtLimit(t *testing.T) {
	w := grepFixture(t, 5000)

	hits, err := w.Grep(context.Background(), "needle", true, "main", "", 7)
	if err != nil {
		t.Fatal(err)
	}

	if len(hits) != 7 {
		t.Fatalf("got %d hits, want 7", len(hits))
	}

	for i, hit := range hits {
		if hit.Repo != "main" || hit.Path != "big.txt" || !strings.HasPrefix(hit.Text, "needle") {
			t.Fatalf("hit %d malformed: %+v", i, hit)
		}
	}
}

func TestGrepReturnsAllMatchesUnderLimit(t *testing.T) {
	w := grepFixture(t, 3)

	hits, err := w.Grep(context.Background(), "needle", true, "main", "", 50)
	if err != nil {
		t.Fatal(err)
	}

	if len(hits) != 3 || hits[0].Line != 1 || hits[2].Line != 3 {
		t.Fatalf("want lines 1..3, got %+v", hits)
	}
}

func TestGrepNoMatchIsEmpty(t *testing.T) {
	w := grepFixture(t, 3)

	hits, err := w.Grep(context.Background(), "absent-token", true, "main", "", 50)
	if err != nil || hits != nil {
		t.Fatalf("no match: hits=%+v err=%v", hits, err)
	}
}

func TestGrepInvalidRegexErrors(t *testing.T) {
	w := grepFixture(t, 3)

	if _, err := w.Grep(context.Background(), "(unclosed", false, "main", "", 50); err == nil {
		t.Fatal("expected an error for an invalid regex")
	}
}

// BenchmarkGrepLimit reports bytes allocated per call when far more lines
// match than the caller asked for.
func BenchmarkGrepLimit(b *testing.B) {
	w := grepFixture(b, 100000)
	ctx := context.Background()

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if _, err := w.Grep(ctx, "needle", true, "main", "", 20); err != nil {
			b.Fatal(err)
		}
	}
}

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
