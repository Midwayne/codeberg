package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/domain"
	"codeberg.org/codeberg/daemon/internal/subprocess"
)

func TestTokenizePipeline(t *testing.T) {
	stages, err := subprocess.TokenizePipeline(`rg -l 'func main' --glob "*.go" | head -20`)
	if err != nil {
		t.Fatalf("tokenize: %v", err)
	}

	want := [][]string{
		{"rg", "-l", "func main", "--glob", "*.go"},
		{"head", "-20"},
	}
	if len(stages) != len(want) {
		t.Fatalf("stages = %v, want %v", stages, want)
	}

	for i := range want {
		if strings.Join(stages[i], "\x00") != strings.Join(want[i], "\x00") {
			t.Fatalf("stage %d = %v, want %v", i, stages[i], want[i])
		}
	}
}

func TestTokenizeRejectsShellOperators(t *testing.T) {
	for _, cmd := range []string{
		`rg foo > out`,
		`rg foo; cat x`,
		`rg $(whoami)`,
		"rg `whoami`",
		`rg foo & rg bar`,
		`rg foo < in`,
		`rg foo || rg bar`,
		``,
	} {
		if _, err := subprocess.TokenizePipeline(cmd); err == nil {
			t.Fatalf("expected rejection for %q", cmd)
		}
	}
}

func TestPipeToolEndToEnd(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, dir, "a.go", "package main\nfunc main() {}\n// TODO: a\n")
	mustWrite(t, dir, "b.go", "package b\n// TODO: b\n")
	mustWrite(t, dir, "c.txt", "no todo here\n")

	tool := pipeTool(wsSingle(dir))

	out := callPipe(t, tool, `rg -l TODO --glob "*.go" | head -1`)
	lines := nonEmptyLines(out.Stdout)
	if len(lines) != 1 {
		t.Fatalf("stdout lines = %v, want 1", lines)
	}

	if !strings.HasSuffix(lines[0], ".go") {
		t.Fatalf("unexpected file %q", lines[0])
	}

	if out.Truncated {
		t.Fatal("unexpected truncation")
	}

	empty := callPipe(t, tool, `rg ZZZ_NOPE | wc -l`)
	if got := strings.TrimSpace(empty.Stdout); got != "0" {
		t.Fatalf("wc on no-match = %q, want 0", got)
	}
}

func TestPipeToolRejectsUnsafe(t *testing.T) {
	tool := pipeTool(wsSingle(t.TempDir()))
	_, err := tool.Call(context.Background(), mustArgs(t, `cat /etc/passwd`))
	if !errors.Is(err, domain.ErrEscape) {
		t.Fatalf("absolute path: got %v", err)
	}

	_, err = tool.Call(context.Background(), mustArgs(t, `rg TODO > out`))
	if !errors.Is(err, subprocess.ErrUnsafe) {
		t.Fatalf("redirection: got %v", err)
	}
}

func callPipe(t *testing.T, tool Tool, command string) subprocess.Result {
	t.Helper()

	res, err := tool.Call(context.Background(), mustArgs(t, command))
	if err != nil {
		t.Fatalf("pipe %q: %v", command, err)
	}

	out, ok := res.(subprocess.Result)
	if !ok {
		t.Fatalf("result type %T", res)
	}

	return out
}

func mustArgs(t *testing.T, command string) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"command": command})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func mustWrite(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func nonEmptyLines(s string) []string {
	var out []string

	for _, l := range strings.Split(s, "\n") {
		if strings.TrimSpace(l) != "" {
			out = append(out, l)
		}
	}
	return out
}
