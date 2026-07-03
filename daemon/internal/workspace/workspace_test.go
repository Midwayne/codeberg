package workspace

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestResolveRejectsEscape(t *testing.T) {
	root := t.TempDir()
	_, err := resolve(root, "../etc/passwd")
	if !errors.Is(err, ErrEscape) {
		t.Fatalf("expected ErrEscape, got %v", err)
	}
}

func TestRootForSingleRepoDefault(t *testing.T) {
	root := t.TempDir()
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	for _, repo := range []string{"", "main", "root"} {
		dir, err := w.rootFor(repo)
		if err != nil || dir != root {
			t.Fatalf("rootFor(%q) = %q, %v; want %q", repo, dir, err, root)
		}
	}
	if _, err := w.rootFor("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown repo: got %v", err)
	}
}

func TestRootForMultiRepoRequiresKey(t *testing.T) {
	rootA, rootB := t.TempDir(), t.TempDir()
	w := New([]RepoInfo{{Key: "alpha", Root: rootA}, {Key: "beta", Root: rootB}}, "")

	if dir, err := w.rootFor("beta"); err != nil || dir != rootB {
		t.Fatalf("rootFor(beta) = %q, %v", dir, err)
	}
	_, err := w.rootFor("")
	if !errors.Is(err, ErrNotFound) || !strings.Contains(err.Error(), "alpha, beta") {
		t.Fatalf("empty repo in multi mode should list keys, got %v", err)
	}
}

func TestMultiRepoIsolation(t *testing.T) {
	rootA, rootB := t.TempDir(), t.TempDir()
	if err := os.WriteFile(rootA+"/only-a.txt", []byte("alpha stuff\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rootB+"/only-b.txt", []byte("beta stuff\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	w := New([]RepoInfo{{Key: "alpha", Root: rootA}, {Key: "beta", Root: rootB}}, "")

	if _, err := w.ReadFile("alpha", "only-a.txt", 0, 0); err != nil {
		t.Fatalf("alpha read: %v", err)
	}
	if _, err := w.ReadFile("alpha", "only-b.txt", 0, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-repo read should be ErrNotFound, got %v", err)
	}

	files, err := w.Glob(context.Background(), "*.txt", "beta", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Repo != "beta" || files[0].Path != "only-b.txt" {
		t.Fatalf("beta glob: %+v", files)
	}
}

func TestReposListsConfigOrder(t *testing.T) {
	w := New([]RepoInfo{{Key: "b", Root: "/x"}, {Key: "a", Root: "/y"}}, "")
	repos := w.Repos()
	if len(repos) != 2 || repos[0].Key != "b" || repos[1].Key != "a" {
		t.Fatalf("repos: %+v", repos)
	}
}
