package workspace

import (
	"context"
	"os"
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
