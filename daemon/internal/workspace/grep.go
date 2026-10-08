package workspace

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func (w *Workspace) Grep(ctx context.Context, pattern string, literal bool, repo, pathGlob string, limit int) ([]GrepMatch, error) {
	return w.grep(ctx, pattern, literal, repo, pathGlob, limit, 0)
}

// GrepForRetrieval limits matches per file so a large generated/test file
// cannot consume the entire lexical candidate budget before other files appear.
func (w *Workspace) GrepForRetrieval(ctx context.Context, pattern, repo, pathGlob string, limit int) ([]GrepMatch, error) {
	return w.grep(ctx, pattern, false, repo, pathGlob, limit, 2)
}

func (w *Workspace) grep(ctx context.Context, pattern string, literal bool, repo, pathGlob string, limit, perFileLimit int) ([]GrepMatch, error) {
	if pattern == "" {
		return nil, fmt.Errorf("codeberg: grep: empty pattern")
	}

	if limit <= 0 || limit > w.maxMatches {
		limit = w.maxMatches
	}

	key, err := w.resolveKey(repo)
	if err != nil {
		return nil, err
	}

	dir := w.byKey[key]
	if _, statErr := os.Stat(dir); statErr != nil {
		return nil, fmt.Errorf("%w: repo", ErrNotFound)
	}

	hits, err := grepRoot(ctx, dir, pattern, literal, pathGlob, limit, perFileLimit)
	if err != nil {
		return nil, err
	}

	for i := range hits {
		hits[i].Repo = key
	}

	return hits, nil
}

func grepRoot(ctx context.Context, dir, pattern string, literal bool, pathGlob string, limit, perFileLimit int) ([]GrepMatch, error) {
	args := []string{"--no-heading", "--line-number", "--with-filename", "--color=never", "--no-messages"}
	if perFileLimit > 0 {
		args = append(args, "--max-count", strconv.Itoa(perFileLimit))
	}

	if literal {
		args = append(args, "--fixed-strings")
	}

	if pathGlob != "" {
		args = append(args, "--glob", pathGlob)
	}

	args = append(args, "--", pattern, ".")

	return runGrep(exec.CommandContext(ctx, "rg", args...), dir, limit)
}

// runGrep streams rg's output and stops it once limit matches are collected,
// so memory tracks the requested matches rather than everything rg finds.
func runGrep(cmd *exec.Cmd, dir string, limit int) ([]GrepMatch, error) {
	cmd.Dir = dir

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("codeberg: grep: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("codeberg: grep: %w", err)
	}

	matches, scanErr := scanGrep(stdout, limit)
	stoppedEarly := scanErr != nil || len(matches) >= limit

	if stoppedEarly {
		_ = cmd.Process.Kill()
	}

	waitErr := cmd.Wait()
	if stoppedEarly {
		return matches, scanErr
	}

	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) && exitErr.ExitCode() == 1 {
			return nil, nil
		}
		return nil, fmt.Errorf("codeberg: grep: %w", waitErr)
	}

	return matches, nil
}

func scanGrep(r io.Reader, limit int) ([]GrepMatch, error) {
	var matches []GrepMatch
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, scanBufInit), scanBufMax)

	for sc.Scan() {
		m, ok := parseGrep(sc.Text())
		if !ok {
			continue
		}

		matches = append(matches, m)
		if len(matches) >= limit {
			break
		}
	}

	return matches, sc.Err()
}

func parseGrep(line string) (GrepMatch, bool) {
	parts := strings.SplitN(line, ":", matchFields)
	if len(parts) != matchFields {
		return GrepMatch{}, false
	}

	n, err := strconv.ParseUint(parts[1], 10, 32)
	if err != nil {
		return GrepMatch{}, false
	}

	path := strings.TrimPrefix(filepath.ToSlash(parts[0]), "./")
	return GrepMatch{Path: path, Line: uint32(n), Text: parts[2]}, true
}
