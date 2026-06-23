package workspace

import (
	"errors"
	"testing"
)

func TestResolveRejectsEscape(t *testing.T) {
	root := t.TempDir()
	_, err := resolve(root, "../etc/passwd")
	if !errors.Is(err, ErrEscape) {
		t.Fatalf("expected ErrEscape, got %v", err)
	}
}
