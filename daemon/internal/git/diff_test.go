package git

import "testing"

func TestParseDiffHunks(t *testing.T) {
	diff := `diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -10,0 +11,2 @@
+func New() {}
+func Old() {}
@@ -20 +22 @@
-func gone() {}
`
	h := ParseDiffHunks(diff)
	lines, ok := h["a.go"]
	if !ok {
		t.Fatalf("missing a.go: %+v", h)
	}
	for _, want := range []uint32{11, 12, 22} {
		if _, ok := lines[want]; !ok {
			t.Fatalf("missing line %d in %+v", want, lines)
		}
	}
	paths := DiffPaths(h)
	if len(paths) != 1 || paths[0] != "a.go" {
		t.Fatalf("DiffPaths: %+v", paths)
	}
}
