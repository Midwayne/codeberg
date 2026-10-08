package workspace

import (
	"bufio"
	"bytes"
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

// grepRoot streams rg output and stops rg once limit matches are read, so a
// broad pattern costs only what the caller keeps rather than buffering every
// match in the tree.
func grepRoot(ctx context.Context, dir, pattern string, literal bool, pathGlob string, limit, perFileLimit int) ([]GrepMatch, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	cmd := exec.CommandContext(ctx, "rg", grepArgs(pattern, literal, pathGlob, perFileLimit)...)
	cmd.Dir = dir

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("codeberg: grep: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("codeberg: grep: %w", err)
	}

	matches, scanErr := scanGrep(stdout, limit)
	full := len(matches) >= limit
	if full || scanErr != nil {
		cancel()
	}

	waitErr := cmd.Wait()
	if scanErr != nil {
		return nil, fmt.Errorf("codeberg: grep: %w", scanErr)
	}

	if full {
		return matches, nil
	}

	return grepResult(matches, waitErr, &stderr)
}

func grepArgs(pattern string, literal bool, pathGlob string, perFileLimit int) []string {
	args := []string{
		"--no-heading", "--line-number", "--with-filename", "--color=never", "--no-messages",
		// Minified bundles and generated data put megabytes on one line; a
		// preview keeps the match location without flooding the model.
		"--max-columns", strconv.Itoa(grepMaxColumns), "--max-columns-preview",
	}

	if perFileLimit > 0 {
		args = append(args, "--max-count", strconv.Itoa(perFileLimit))
	}

	if literal {
		args = append(args, "--fixed-strings")
	}

	if pathGlob != "" {
		args = append(args, "--glob", pathGlob)
	}

	return append(args, "--", pattern, ".")
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
			return matches, nil
		}
	}

	return matches, sc.Err()
}

// grepResult interprets rg's exit after its output was fully read: status 1
// means no matches, anything else is a failure worth reporting.
func grepResult(matches []GrepMatch, waitErr error, stderr *bytes.Buffer) ([]GrepMatch, error) {
	if waitErr == nil {
		return matches, nil
	}

	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) && exitErr.ExitCode() == 1 {
		return nil, nil
	}

	if msg := strings.TrimSpace(stderr.String()); msg != "" {
		return nil, fmt.Errorf("codeberg: grep: %w: %s", waitErr, msg)
	}

	return nil, fmt.Errorf("codeberg: grep: %w", waitErr)
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
