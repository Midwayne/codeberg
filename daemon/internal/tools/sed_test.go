package tools

import (
	"errors"
	"testing"
)

func TestValidateSedScript(t *testing.T) {
	if err := validateSedScript("s/foo/bar/"); err != nil {
		t.Fatalf("safe script: %v", err)
	}
	if err := validateSedScript(""); err == nil {
		t.Fatal("empty script should fail")
	}
	if err := validateSedScript("w /tmp/out"); !errors.Is(err, ErrUnsafeSed) {
		t.Fatalf("write command: %v", err)
	}
	if err := validateSedScript("s/a/b/w"); !errors.Is(err, ErrUnsafeSed) {
		t.Fatalf("s write flag: %v", err)
	}
}
