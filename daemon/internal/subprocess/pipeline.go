package subprocess

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	maxOutput  = 256 * 1024
	runTimeout = 15 * time.Second
)

// Result is the output of a validated read-only pipeline.
type Result struct {
	Command   string `json:"command"`
	Stdout    string `json:"stdout"`
	Truncated bool   `json:"truncated"`
	ExitCodes []int  `json:"exit_codes"`
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
