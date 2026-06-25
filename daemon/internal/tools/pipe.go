package tools

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

const (
	maxPipeOutput = 256 * 1024
	pipeTimeout   = 15 * time.Second
)

// ErrUnsafePipe is returned when a pipeline uses a disallowed command, flag, or
// shell operator. It maps to HTTP 400 (see HTTPStatus).
var ErrUnsafePipe = errors.New("codeberg: pipe command is not allowed")

// allowedPipeCommands is the read-only command allowlist. awk and xargs are
// deliberately excluded: both can execute arbitrary commands (awk system()/
// redirection, xargs runs a program), which an allowlist alone cannot contain.
var allowedPipeCommands = map[string]bool{
	"rg": true, "grep": true, "head": true, "tail": true, "wc": true,
	"sort": true, "uniq": true, "cut": true, "tr": true, "nl": true,
	"cat": true, "paste": true, "sed": true,
}

// deniedFlags lists the write/exec-capable flags of otherwise read-only tools.
// Matched against a flag's core (the part before any '=').
var deniedFlags = map[string]map[string]bool{
	"rg": {
		"--pre": true, "--pre-glob": true, "--hostname-bin": true,
		"--search-zip": true, "-z": true,
	},
	"sort": {
		"-o": true, "--output": true, "--files0-from": true,
	},
	"sed": {
		"-i": true, "--in-place": true, "-f": true, "--file": true,
	},
}

func pipeTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "command": {"type": "string", "description": "read-only pipeline, e.g. \"rg -l TODO --glob '*.go' | head -20\". Stages joined by | ; no shell is run, so > < ; & $() and backticks are rejected."},
    "repo": {"type": "string", "description": "repo key (default root)"}
  },
  "required": ["command"]
}`
	type args struct {
		Command string `json:"command"`
		Repo    string `json:"repo"`
	}
	return New("pipe",
		"Run a read-only pipeline over the repo in ONE call, chaining rg/grep with text "+
			"filters (head, tail, wc, sort, uniq, cut, tr, nl, cat, paste, sed) using '|'. "+
			"The first stage searches repo files; later stages filter stdin. No shell is "+
			"invoked: redirection, command substitution, ';' and '&' are rejected, and paths "+
			"cannot escape the repo. Prefer this over several grep/read_file calls.",
		schema,
		func(ctx context.Context, a args) (any, error) {
			stages, err := tokenizePipeline(a.Command)
			if err != nil {
				return nil, err
			}
			for _, st := range stages {
				if err := validateStage(st); err != nil {
					return nil, err
				}
			}
			root, err := ws.RepoRoot(a.Repo)
			if err != nil {
				return nil, err
			}
			return runPipeline(ctx, root, a.Command, stages)
		})
}

// tokenizePipeline splits a command string into per-stage argv lists. It is
// quote-aware ('...' and "..."), treats an unquoted '|' as the stage separator,
// and rejects unquoted shell-control metacharacters — no shell is ever invoked.
func tokenizePipeline(command string) ([][]string, error) {
	if strings.TrimSpace(command) == "" {
		return nil, fmt.Errorf("%w: empty command", ErrInvalidArgs)
	}

	var (
		stages [][]string
		cur    []string
		tok    strings.Builder
		hasTok bool
	)
	flushTok := func() {
		if hasTok {
			cur = append(cur, tok.String())
			tok.Reset()
			hasTok = false
		}
	}
	flushStage := func() error {
		flushTok()
		if len(cur) == 0 {
			return fmt.Errorf("%w: empty pipeline stage", ErrUnsafePipe)
		}
		stages = append(stages, cur)
		cur = nil
		return nil
	}

	r := []rune(command)
	for i := 0; i < len(r); i++ {
		switch c := r[i]; c {
		case '\'':
			hasTok = true
			i++
			for i < len(r) && r[i] != '\'' {
				tok.WriteRune(r[i])
				i++
			}
			if i >= len(r) {
				return nil, fmt.Errorf("%w: unterminated single quote", ErrInvalidArgs)
			}
		case '"':
			hasTok = true
			i++
			for i < len(r) && r[i] != '"' {
				if r[i] == '\\' && i+1 < len(r) && (r[i+1] == '"' || r[i+1] == '\\') {
					tok.WriteRune(r[i+1])
					i += 2
					continue
				}
				tok.WriteRune(r[i])
				i++
			}
			if i >= len(r) {
				return nil, fmt.Errorf("%w: unterminated double quote", ErrInvalidArgs)
			}
		case '\\':
			if i+1 < len(r) {
				tok.WriteRune(r[i+1])
				hasTok = true
				i++
			}
		case ' ', '\t':
			flushTok()
		case '|':
			if err := flushStage(); err != nil {
				return nil, err
			}
		case '>', '<', ';', '&', '$', '`', '(', ')', '{', '}', '\n', '\r':
			return nil, fmt.Errorf("%w: shell operator %q", ErrUnsafePipe, string(c))
		default:
			tok.WriteRune(c)
			hasTok = true
		}
	}
	if err := flushStage(); err != nil {
		return nil, err
	}
	return stages, nil
}

func validateStage(argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("%w: empty stage", ErrUnsafePipe)
	}
	cmd := argv[0]
	if !allowedPipeCommands[cmd] {
		return fmt.Errorf("%w: command %q", ErrUnsafePipe, cmd)
	}
	denied := deniedFlags[cmd]
	for _, arg := range argv[1:] {
		flagCore := arg
		if strings.HasPrefix(arg, "-") {
			if before, _, found := strings.Cut(arg, "="); found {
				flagCore = before
			}
		}
		if denied[flagCore] {
			return fmt.Errorf("%w: flag %q for %q", ErrUnsafePipe, flagCore, cmd)
		}
		if err := checkPathToken(arg); err != nil {
			return err
		}
	}
	if cmd == "sed" {
		return validateSedArgs(argv[1:])
	}
	return nil
}

// checkPathToken rejects absolute paths and ".." traversal in a token (and in the
// value after '=' for --flag=value forms), so a stage cannot read outside the repo
// root it runs in.
func checkPathToken(arg string) error {
	candidates := []string{arg}
	if _, after, found := strings.Cut(arg, "="); found {
		candidates = append(candidates, after)
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if filepath.IsAbs(c) {
			return fmt.Errorf("%w: absolute path %q", workspace.ErrEscape, c)
		}
		if hasDotDot(c) {
			return fmt.Errorf("%w: %q", workspace.ErrEscape, c)
		}
	}
	return nil
}

func hasDotDot(p string) bool {
	return slices.Contains(strings.Split(strings.ReplaceAll(p, "\\", "/"), "/"), "..")
}

// validateSedArgs ensures every sed script in the stage is read-only (reuses
// validateSedScript, which blocks w/W/e). The first non-flag operand is the
// script; later bare operands are file paths (already path-checked).
func validateSedArgs(args []string) error {
	scriptSeen := false
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-n" || a == "--quiet" || a == "--silent":
		case a == "-e" || a == "--expression":
			scriptSeen = true
			if i+1 < len(args) {
				if err := validateSedScript(args[i+1]); err != nil {
					return err
				}
				i++
			}
		case strings.HasPrefix(a, "-e"):
			scriptSeen = true
			if err := validateSedScript(a[2:]); err != nil {
				return err
			}
		case strings.HasPrefix(a, "--expression="):
			scriptSeen = true
			if err := validateSedScript(strings.TrimPrefix(a, "--expression=")); err != nil {
				return err
			}
		case strings.HasPrefix(a, "-"):
			return fmt.Errorf("%w: sed flag %q", ErrUnsafePipe, a)
		default:
			if !scriptSeen {
				scriptSeen = true
				if err := validateSedScript(a); err != nil {
					return err
				}
			}
		}
	}
	if !scriptSeen {
		return fmt.Errorf("%w: sed requires a script", ErrInvalidArgs)
	}
	return nil
}

// runPipeline executes the validated stages sequentially, feeding each stage's
// (bounded) stdout as the next stage's stdin. Every stage runs rooted at the repo
// with a scrubbed environment; a nonzero exit (e.g. rg's exit 1 for "no matches")
// is recorded but tolerated, matching grepRoot.
func runPipeline(ctx context.Context, root, command string, stages [][]string) (any, error) {
	ctx, cancel := context.WithTimeout(ctx, pipeTimeout)
	defer cancel()

	env := pipelineEnv()
	exitCodes := make([]int, len(stages))
	truncated := false
	var stream []byte

	for i, st := range stages {
		c := exec.CommandContext(ctx, st[0], st[1:]...)
		c.Dir = root
		c.Env = env
		if i > 0 {
			c.Stdin = bytes.NewReader(stream)
		}
		var buf bytes.Buffer
		lw := &limitedWriter{w: &buf, limit: maxPipeOutput}
		c.Stdout = lw
		c.Stderr = io.Discard

		err := c.Run()
		if err != nil {
			var exitErr *exec.ExitError
			if !errors.As(err, &exitErr) {
				if ctx.Err() == context.DeadlineExceeded {
					return nil, fmt.Errorf("codeberg: pipe: timed out after %s", pipeTimeout)
				}
				return nil, fmt.Errorf("codeberg: pipe: %s: %w", st[0], err)
			}
		}
		exitCodes[i] = exitCodeOf(err)
		truncated = truncated || lw.truncated
		stream = buf.Bytes()
	}

	return map[string]any{
		"command":    command,
		"stdout":     string(stream),
		"truncated":  truncated,
		"exit_codes": exitCodes,
	}, nil
}

func exitCodeOf(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

// pipelineEnv inherits the daemon environment but neutralizes config that could
// re-enable unsafe behavior (notably a ripgrep config that adds --pre).
func pipelineEnv() []string {
	base := os.Environ()
	out := make([]string, 0, len(base)+2)
	for _, kv := range base {
		key, _, _ := strings.Cut(kv, "=")
		switch key {
		case "RIPGREP_CONFIG_PATH", "GIT_TERMINAL_PROMPT":
			continue
		}
		out = append(out, kv)
	}
	return append(out, "RIPGREP_CONFIG_PATH=", "GIT_TERMINAL_PROMPT=0")
}

// limitedWriter caps how many bytes reach the underlying writer; excess is
// discarded and truncated is set. It never errors, so the upstream process runs
// to completion instead of dying on a short write.
type limitedWriter struct {
	w         io.Writer
	limit     int
	n         int
	truncated bool
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if l.n >= l.limit {
		l.truncated = true
		return len(p), nil
	}
	remain := l.limit - l.n
	if len(p) > remain {
		nw, err := l.w.Write(p[:remain])
		l.n += nw
		l.truncated = true
		if err != nil {
			return nw, err
		}
		return len(p), nil
	}
	nw, err := l.w.Write(p)
	l.n += nw
	return nw, err
}
