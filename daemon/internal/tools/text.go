package tools

import (
	"context"
	"fmt"
	"strings"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

const defaultHeadTail = 20

func headTool(ws *workspace.Workspace) Tool {
	return headTailTool(ws, "head", false, "Return the first N lines of a file (default 20).")
}

func tailTool(ws *workspace.Workspace) Tool {
	return headTailTool(ws, "tail", true, "Return the last N lines of a file (default 20).")
}

func headTailTool(ws *workspace.Workspace, name string, fromEnd bool, description string) Tool {
	edge := "leading"
	if fromEnd {
		edge = "trailing"
	}
	schema := fmt.Sprintf(`{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative path"},
    "lines": {"type": "integer", "description": "number of %s lines (default 20)"}
  },
  "required": ["path"]
}`, edge)

	return New(name, description, schema,
		func(_ context.Context, a pathLinesArgs) (any, error) {
			lines, err := readLines(ws, a.Repo, a.Path)
			if err != nil {
				return nil, err
			}

			n := a.Lines
			if n <= 0 {
				n = defaultHeadTail
			}

			sliced, count := sliceLines(lines, n, fromEnd)
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
