package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

func TestTokenizePipeline(t *testing.T) {
	stages, err := tokenizePipeline(`rg -l 'func main' --glob "*.go" | head -20`)
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
		`rg foo || rg bar`, // empty stage between the two pipes
		``,
	} {
		if _, err := tokenizePipeline(cmd); err == nil {
			t.Fatalf("expected rejection for %q", cmd)
		}
	}
}

func TestValidateStage(t *testing.T) {
	tests := []struct {
		name string
		argv []string
		ok   bool
	}{
		{"allowed rg", []string{"rg", "-l", "TODO"}, true},
		{"allowed head", []string{"head", "-5"}, true},
		{"allowed sed read-only", []string{"sed", "-n", "1,5p"}, true},
		{"allowed relative path", []string{"rg", "TODO", "src/"}, true},
		{"unknown command", []string{"python", "-c", "x"}, false},
		{"awk excluded", []string{"awk", "{print}"}, false},
		{"xargs excluded", []string{"xargs", "rm"}, false},
		{"rg pre flag", []string{"rg", "--pre", "sh", "x"}, false},
		{"rg pre eq flag", []string{"rg", "--pre=sh", "x"}, false},
		{"sort output flag", []string{"sort", "-o", "out"}, false},
		{"sed in-place", []string{"sed", "-i", "s/a/b/"}, false},
		{"sed write script", []string{"sed", "s/a/b/w file"}, false},
		{"absolute path", []string{"cat", "/etc/passwd"}, false},
		{"dotdot traversal", []string{"rg", "TODO", "../other"}, false},
		{"absolute via flag value", []string{"rg", "--glob=/etc/*", "x"}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateStage(tc.argv)
			if tc.ok && err != nil {
				t.Fatalf("want ok, got %v", err)
			}
			if !tc.ok && err == nil {
				t.Fatal("want rejection, got nil")
			}
		})
	}
}

func TestPipeToolEndToEnd(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, dir, "a.go", "package main\nfunc main() {}\n// TODO: a\n")
	mustWrite(t, dir, "b.go", "package b\n// TODO: b\n")
	mustWrite(t, dir, "c.txt", "no todo here\n")

	tool := pipeTool(wsSingle(dir))

	// rg lists the two .go files with TODO; head keeps the first one.
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

	// No match: rg exits 1, which is tolerated and yields empty stdout.
	empty := callPipe(t, tool, `rg ZZZ_NOPE | wc -l`)
	if got := strings.TrimSpace(empty.Stdout); got != "0" {
		t.Fatalf("wc on no-match = %q, want 0", got)
	}
}

func TestPipeToolRejectsUnsafe(t *testing.T) {
	tool := pipeTool(wsSingle(t.TempDir()))
	_, err := tool.Call(context.Background(), mustArgs(t, `cat /etc/passwd`))
	if !errors.Is(err, workspace.ErrEscape) {
		t.Fatalf("absolute path: got %v", err)
	}
	_, err = tool.Call(context.Background(), mustArgs(t, `rg TODO > out`))
	if !errors.Is(err, ErrUnsafePipe) {
		t.Fatalf("redirection: got %v", err)
	}
}

func callPipe(t *testing.T, tool Tool, command string) pipeResult {
	t.Helper()

	res, err := tool.Call(context.Background(), mustArgs(t, command))
	if err != nil {
		t.Fatalf("pipe %q: %v", command, err)
	}

	out, ok := res.(pipeResult)
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
