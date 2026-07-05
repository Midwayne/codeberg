package tools

import (
	"context"
	"strings"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

const defaultHeadTail = 20

func headTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative path"},
    "lines": {"type": "integer", "description": "number of leading lines (default 20)"}
  },
  "required": ["path"]
}`

	return New("head", "Return the first N lines of a file (default 20).", schema,
		func(_ context.Context, a pathLinesArgs) (any, error) {
			lines, err := readLines(ws, a.Repo, a.Path)
			if err != nil {
				return nil, err
			}

			n := a.Lines
			if n <= 0 {
				n = defaultHeadTail
			}

			sliced, count := sliceLines(lines, n, false)
			return headTailResult{Content: strings.Join(sliced, "\n"), Lines: count}, nil
		})
}

func tailTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative path"},
    "lines": {"type": "integer", "description": "number of trailing lines (default 20)"}
  },
  "required": ["path"]
}`

	return New("tail", "Return the last N lines of a file (default 20).", schema,
		func(_ context.Context, a pathLinesArgs) (any, error) {
			lines, err := readLines(ws, a.Repo, a.Path)
			if err != nil {
				return nil, err
			}

			n := a.Lines
			if n <= 0 {
				n = defaultHeadTail
			}

			sliced, count := sliceLines(lines, n, true)
			return headTailResult{Content: strings.Join(sliced, "\n"), Lines: count}, nil
		})
}

func wcTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative path"}
  },
  "required": ["path"]
}`

	return New("wc", "Count lines, words and bytes of a file.", schema,
		func(_ context.Context, a wcArgs) (any, error) {
			data, err := ws.ReadRaw(a.Repo, a.Path)
			if err != nil {
				return nil, err
			}

			text := string(data)
			lines := strings.Count(text, "\n")
			if len(text) > 0 && !strings.HasSuffix(text, "\n") {
				lines++
			}

			return wcResult{
				Lines: lines,
				Words: len(strings.Fields(text)),
				Bytes: len(data),
			}, nil
		})
}

func sliceLines(lines []string, n int, fromEnd bool) ([]string, int) {
	if n > len(lines) {
		n = len(lines)
	}
	if fromEnd {
		return lines[len(lines)-n:], n
	}
	return lines[:n], n
}

func readLines(ws *workspace.Workspace, repo, path string) ([]string, error) {
	data, err := ws.ReadRaw(repo, path)
	if err != nil {
		return nil, err
	}

	text := strings.TrimSuffix(string(data), "\n")
	if text == "" {
		return nil, nil
	}

	return strings.Split(text, "\n"), nil
}
