package tools

import (
	"context"
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

	if err := subprocess.ValidateSedScript("w /tmp/out"); !errors.Is(err, subprocess.ErrUnsafeSed) {
		t.Fatalf("write command: %v", err)
	}

	if err := subprocess.ValidateSedScript("s/a/b/w"); !errors.Is(err, subprocess.ErrUnsafeSed) {
		t.Fatalf("s write flag: %v", err)
	}
}

func TestSedToolRunsAddressScriptsOverFileText(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, dir, "notes.txt", "alpha\nbeta\nalphabet\n")
	t.Setenv("RIPGREP_CONFIG_PATH", "/nonexistent")

	tool := sedTool(wsSingle(dir))

	res, err := tool.Call(context.Background(), []byte(`{"path":"notes.txt","script":"/^alpha/p","quiet":true}`))
	if err != nil {
		t.Fatal(err)
	}

	if got := res.(sedResult).Content; got != "alpha\nalphabet\n" {
		t.Fatalf("content = %q", got)
	}

	if _, err := tool.Call(context.Background(), []byte(`{"path":"notes.txt","script":"p;}"}`)); err == nil {
		t.Fatal("invalid script should fail")
	}
}
