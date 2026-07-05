package tools

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

const (
	defaultGitLogLimit = 20
	maxGitLogLimit     = 200
	maxBlameOutput     = 128 * 1024
	logFieldSep        = "\x1f"
	logFieldCount      = 4
)

type commit struct {
	Hash    string `json:"hash"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
}

func gitLogTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "restrict history to this path (optional)"},
    "limit": {"type": "integer", "description": "max commits (default 20)"}
  }
}`

	return New("git_log",
		"Recent commits (hash, author, date, subject) for a repo or path.",
		schema,
		func(ctx context.Context, a gitLogArgs) (any, error) {
			root, err := ws.RepoRoot(a.Repo)
			if err != nil {
				return nil, err
			}

			limit := a.Limit
			if limit <= 0 || limit > maxGitLogLimit {
				limit = defaultGitLogLimit
			}

			gitArgs := []string{
				"-C", root, "log", "--no-color", fmt.Sprintf("--max-count=%d", limit),
				"--date=short", "--pretty=format:%H" + logFieldSep + "%an" + logFieldSep + "%ad" + logFieldSep + "%s",
			}
			if a.Path != "" {
				rel, relErr := workspace.SafeRel(a.Path)
				if relErr != nil {
					return nil, relErr
				}
				gitArgs = append(gitArgs, "--", rel)
			}

			out, err := runGit(ctx, gitArgs...)
			if err != nil {
				return nil, err
			}

			return parseLog(out), nil
		})
}

func gitBlameTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative file path"},
    "start_line": {"type": "integer", "description": "1-based start line (optional)"},
    "end_line": {"type": "integer", "description": "1-based end line (optional)"}
  },
  "required": ["path"]
}`

	return New("git_blame",
		"Per-line authorship for a file or line range.",
		schema,
		func(ctx context.Context, a gitBlameArgs) (any, error) {
			root, err := ws.RepoRoot(a.Repo)
			if err != nil {
				return nil, err
			}

			rel, err := workspace.SafeRel(a.Path)
			if err != nil {
				return nil, err
			}
			if rel == "." {
				return nil, fmt.Errorf("%w: git_blame requires a file path", ErrInvalidArgs)
			}

			gitArgs := []string{"-C", root, "blame"}
			if a.StartLine > 0 {
				span := fmt.Sprintf("%d", a.StartLine)
				if a.EndLine >= a.StartLine {
					span = fmt.Sprintf("%d,%d", a.StartLine, a.EndLine)
				}
				gitArgs = append(gitArgs, "-L", span)
			}
			gitArgs = append(gitArgs, "--", rel)

			out, err := runGit(ctx, gitArgs...)
			if err != nil {
				return nil, err
			}

			truncated := false
			if len(out) > maxBlameOutput {
				out, truncated = out[:maxBlameOutput], true
			}

			return gitBlameResult{Blame: out, Truncated: truncated}, nil
		})
}

func parseLog(out string) []commit {
	var commits []commit

	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if line == "" {
			continue
		}

		f := strings.Split(line, logFieldSep)
		if len(f) != logFieldCount {
			continue
		}

		commits = append(commits, commit{
			Hash: f[0], Author: f[1], Date: f[2], Subject: f[3],
		})
	}

	return commits
}

func runGit(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", fmt.Errorf("codeberg: git: %w: %s", err, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("codeberg: git: %w", err)
	}

	return string(out), nil
}
