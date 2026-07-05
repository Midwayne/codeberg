package workspace

import (
	"context"
	"errors"
	"fmt"
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

func TestReadFileTruncatesAtMaxBytes(t *testing.T) {
	root := t.TempDir()
	line := strings.Repeat("x", 100) + "\n"
	var b strings.Builder
	for b.Len() < 70*1024 {
		b.WriteString(line)
	}
	if err := os.WriteFile(root+"/big.txt", []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	out, err := w.ReadFile("main", "big.txt", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Content) != 64*1024 {
		t.Fatalf("content len %d want %d", len(out.Content), 64*1024)
	}
	if out.TotalLines == 0 {
		t.Fatal("total lines should be set")
	}
}

func TestReadRawRejectsOversize(t *testing.T) {
	root := t.TempDir()
	big := make([]byte, 4*1024*1024+1)
	if err := os.WriteFile(root+"/huge.bin", big, 0o644); err != nil {
		t.Fatal(err)
	}
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	if _, err := w.ReadRaw("main", "huge.bin"); err == nil {
		t.Fatal("expected error for oversized file")
	}
}

func TestGlobRespectsLimit(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 510; i++ {
		name := root + "/" + fmt.Sprintf("file%03d.txt", i)
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")

	files, err := w.Glob(context.Background(), "file*.txt", "main", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 500 {
		t.Fatalf("glob capped at 500, got %d", len(files))
	}
}

func TestTreeSkipsVendorDirs(t *testing.T) {
	root := t.TempDir()
	for _, dir := range []string{"node_modules/pkg", ".git/objects", "src"} {
		if err := os.MkdirAll(root+"/"+dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(root+"/src/ok.go", []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root+"/node_modules/pkg/hidden.go", []byte("hidden\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	w := New([]RepoInfo{{Key: "main", Root: root}}, "main")
	nodes, err := w.Tree("main", ".", 3)
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range nodes {
		if strings.Contains(n.Path, "node_modules") || strings.Contains(n.Path, ".git") {
			t.Fatalf("skipped dir appeared in tree: %+v", n)
		}
	}
	foundSrc := false
	for _, n := range nodes {
		if n.Path == "src/ok.go" {
			foundSrc = true
		}
	}
	if !foundSrc {
		t.Fatalf("expected src/ok.go in tree, got %+v", nodes)
	}
}
