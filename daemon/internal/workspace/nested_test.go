package workspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// teamFixture is a project directory "team" holding a repository "api" that is
// configured as its own root, plus "apiary", which only shares a name prefix.
func teamFixture(t *testing.T) *Workspace {
	t.Helper()

	team := t.TempDir()
	files := map[string]string{
		"README.md":      "needle team\n",
		"api/main.go":    "needle api\n",
		"api/pkg/lib.go": "needle lib\n",
		"apiary/hive.go": "needle hive\n",
	}

	for rel, body := range files {
		path := filepath.Join(team, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}

		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	return New([]RepoInfo{{Key: "team", Root: team}, {Key: "api", Root: filepath.Join(team, "api")}}, "team")
}

func paths[T any](items []T, path func(T) string) map[string]bool {
	out := map[string]bool{}

	for _, item := range items {
		out[path(item)] = true
	}

	return out
}

func TestGrepLeavesNestedRootsToThemselves(t *testing.T) {
	w := teamFixture(t)

	team, err := w.Grep(context.Background(), "needle", true, "team", "", 50)
	if err != nil {
		t.Fatal(err)
	}

	got := paths(team, func(m GrepMatch) string { return m.Path })
	if !got["README.md"] || !got["apiary/hive.go"] || got["api/main.go"] || got["api/pkg/lib.go"] {
		t.Fatalf("team grep = %v", got)
	}

	api, err := w.Grep(context.Background(), "needle", true, "api", "", 50)
	if err != nil {
		t.Fatal(err)
	}

	if got := paths(api, func(m GrepMatch) string { return m.Path }); !got["main.go"] || !got["pkg/lib.go"] {
		t.Fatalf("api grep = %v", got)
	}
}

func TestGrepPathGlobStillHonoursNestedRoots(t *testing.T) {
	w := teamFixture(t)

	hits, err := w.Grep(context.Background(), "needle", true, "team", "**/*.go", 50)
	if err != nil {
		t.Fatal(err)
	}

	if got := paths(hits, func(m GrepMatch) string { return m.Path }); len(got) != 1 || !got["apiary/hive.go"] {
		t.Fatalf("team grep with glob = %v", got)
	}
}

func TestGlobAndTreeLeaveNestedRootsToThemselves(t *testing.T) {
	w := teamFixture(t)

	files, err := w.Glob(context.Background(), "**/*.go", "team", 50)
	if err != nil {
		t.Fatal(err)
	}

	if got := paths(files, func(f FileRef) string { return f.Path }); len(got) != 1 || !got["apiary/hive.go"] {
		t.Fatalf("team glob = %v", got)
	}

	nodes, err := w.Tree("team", "", 5)
	if err != nil {
		t.Fatal(err)
	}

	got := paths(nodes, func(n TreeNode) string { return n.Path })
	if !got["api"] || got["api/main.go"] || got["api/pkg"] || !got["apiary/hive.go"] {
		t.Fatalf("team tree = %v", got)
	}
}
