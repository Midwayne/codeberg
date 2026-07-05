package tools

import (
	"errors"
	"testing"

	"codeberg.org/codeberg/daemon/internal/subprocess"
)

func TestValidateSedScript(t *testing.T) {
	if err := subprocess.ValidateSedScript("s/foo/bar/"); err != nil {
		t.Fatalf("safe script: %v", err)
	}
	if err := subprocess.ValidateSedScript(""); err == nil {
		t.Fatal("empty script should fail")
	}
	if err := subprocess.ValidateSedScript("w /tmp/out"); !errors.Is(err, ErrUnsafeSed) {
		t.Fatalf("write command: %v", err)
	}
	if err := subprocess.ValidateSedScript("s/a/b/w"); !errors.Is(err, ErrUnsafeSed) {
		t.Fatalf("s write flag: %v", err)
	}
}
