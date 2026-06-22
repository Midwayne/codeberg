package cberg

import "testing"

func TestSkipDir(t *testing.T) {
	if !SkipDir(".git") || !SkipDir("node_modules") {
		t.Fatal("expected skip")
	}
	if SkipDir("src") {
		t.Fatal("src should not skip")
	}
}
