package git

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const runTimeout = 30 * time.Second

// Run executes a git command in dir and returns combined stdout/stderr.
func Run(ctx context.Context, dir string, args ...string) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	runCtx, cancel := context.WithTimeout(ctx, runTimeout)
	defer cancel()

	cmd := exec.CommandContext(runCtx, "git", args...)
	cmd.Dir = dir

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(buf.String()))
	}

	return buf.String(), nil
}

func parseLog(out string) []string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return nil
	}

	return lines
}

// ParseLogFields splits formatted log lines on fieldSep into field slices.
func ParseLogFields(out, fieldSep string, fieldCount int) [][]string {
	var rows [][]string
	for _, line := range parseLog(out) {
		f := strings.Split(line, fieldSep)
		if len(f) != fieldCount {
			continue
		}
		rows = append(rows, f)
	}

	return rows
}
