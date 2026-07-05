package subprocess

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
	maxOutput   = 256 * 1024
	runTimeout  = 15 * time.Second
)

// Result is the output of a validated read-only pipeline.
type Result struct {
	Command   string `json:"command"`
	Stdout    string `json:"stdout"`
	Truncated bool   `json:"truncated"`
	ExitCodes []int  `json:"exit_codes"`
}

var allowedCommands = map[string]bool{
	"rg": true, "grep": true, "head": true, "tail": true, "wc": true,
	"sort": true, "uniq": true, "cut": true, "tr": true, "nl": true,
	"cat": true, "paste": true, "sed": true,
}

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

// RunPipeline executes a validated read-only pipeline rooted at dir.
func RunPipeline(ctx context.Context, dir, command string) (Result, error) {
	stages, err := TokenizePipeline(command)
	if err != nil {
		return Result{}, err
	}

	for _, st := range stages {
		if err := validateStage(st); err != nil {
			return Result{}, err
		}
	}

	return executePipeline(ctx, dir, command, stages)
}

// TokenizePipeline splits a command string into per-stage argv lists.
func TokenizePipeline(command string) ([][]string, error) {
	if strings.TrimSpace(command) == "" {
		return nil, fmt.Errorf("%w: empty command", ErrInvalid)
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
			return fmt.Errorf("%w: empty pipeline stage", ErrUnsafe)
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
				return nil, fmt.Errorf("%w: unterminated single quote", ErrInvalid)
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
				return nil, fmt.Errorf("%w: unterminated double quote", ErrInvalid)
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
			return nil, fmt.Errorf("%w: shell operator %q", ErrUnsafe, string(c))
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

// ValidateStage checks one pipeline stage against the read-only allowlist.
func ValidateStage(argv []string) error {
	return validateStage(argv)
}

func validateStage(argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("%w: empty stage", ErrUnsafe)
	}

	cmd := argv[0]
	if !allowedCommands[cmd] {
		return fmt.Errorf("%w: command %q", ErrUnsafe, cmd)
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
			return fmt.Errorf("%w: flag %q for %q", ErrUnsafe, flagCore, cmd)
		}
		if err := checkPathToken(arg); err != nil {
			return err
		}
	}

	if cmd == "sed" {
		return ValidateSedArgs(argv[1:])
	}

	return nil
}

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

func executePipeline(ctx context.Context, root, command string, stages [][]string) (Result, error) {
	ctx, cancel := context.WithTimeout(ctx, runTimeout)
	defer cancel()

	env := scrubbedEnv()
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
		lw := &limitedWriter{w: &buf, limit: maxOutput}
		c.Stdout = lw
		c.Stderr = io.Discard

		err := c.Run()
		if err != nil {
			var exitErr *exec.ExitError
			if !errors.As(err, &exitErr) {
				if ctx.Err() == context.DeadlineExceeded {
					return Result{}, fmt.Errorf("codeberg: pipe: timed out after %s", runTimeout)
				}
				return Result{}, fmt.Errorf("codeberg: pipe: %s: %w", st[0], err)
			}
		}

		exitCodes[i] = exitCodeOf(err)
		truncated = truncated || lw.truncated
		stream = buf.Bytes()
	}

	return Result{
		Command:   command,
		Stdout:    string(stream),
		Truncated: truncated,
		ExitCodes: exitCodes,
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

func scrubbedEnv() []string {
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
