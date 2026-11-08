package storage

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestIndexFamilyExcludesNeighbors(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, IndexFile)

	for _, name := range []string{IndexFile, IndexFile + ".0123.chunks", IndexFile + "-unrelated", "other.usearch"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0600); err != nil {
			t.Fatal(err)
		}
	}

	family, err := IndexFamily(base)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{base, base + ".0123.chunks"}
	if !slices.Equal(family, want) {
		t.Fatalf("family = %v, want %v", family, want)
	}

	if missing, err := IndexFamily(filepath.Join(dir, "absent", IndexFile)); err != nil || missing != nil {
		t.Fatalf("missing directory: %v %v", missing, err)
	}
}

func TestLayoutKeepsProjectsApart(t *testing.T) {
	a, b := Layout{Home: "/home/a/.codeberg"}, Layout{Home: "/home/b/.codeberg"}

	if a.ProjectSocket("p-1") == b.ProjectSocket("p-1") || a.ProjectSocket("p-1") == a.ProjectSocket("p-2") {
		t.Fatal("indexer sockets collide across homes or projects")
	}

	if got := a.ProjectIndex("p-1", ""); got != "/home/a/.codeberg/projects/p-1/index/codeberg.usearch" {
		t.Fatalf("default index: %s", got)
	}

	if !a.InLegacyIndexDir("/home/a/.codeberg/index/codeberg.usearch") || a.InLegacyIndexDir("/home/a/.codeberg/indexes/x") {
		t.Fatal("legacy index directory match is not path-aware")
	}

	if tag := familyTag(IndexFile, IndexFile+".0123.chunks"); tag != "0123" || !strings.HasPrefix(IndexFile, "codeberg") {
		t.Fatalf("family tag: %q", tag)
	}
}
