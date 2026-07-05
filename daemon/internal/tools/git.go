package tools

import (
	"context"
	"fmt"

	"codeberg.org/codeberg/daemon/internal/git"
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
				"log", "--no-color", fmt.Sprintf("--max-count=%d", limit),
				"--date=short", "--pretty=format:%H" + logFieldSep + "%an" + logFieldSep + "%ad" + logFieldSep + "%s",
			}
			if a.Path != "" {
				rel, relErr := workspace.SafeRel(a.Path)
				if relErr != nil {
					return nil, relErr
				}
				gitArgs = append(gitArgs, "--", rel)
			}

			out, err := git.Run(ctx, root, gitArgs...)
			if err != nil {
				return nil, err
			}

			var commits []commit
			for _, f := range git.ParseLogFields(out, logFieldSep, logFieldCount) {
				commits = append(commits, commit{
					Hash: f[0], Author: f[1], Date: f[2], Subject: f[3],
				})
			}

			return commits, nil
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

			gitArgs := []string{"blame"}
			if a.StartLine > 0 {
				span := fmt.Sprintf("%d", a.StartLine)
				if a.EndLine >= a.StartLine {
					span = fmt.Sprintf("%d,%d", a.StartLine, a.EndLine)
				}
				gitArgs = append(gitArgs, "-L", span)
			}
			gitArgs = append(gitArgs, "--", rel)

			out, err := git.Run(ctx, root, gitArgs...)
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
