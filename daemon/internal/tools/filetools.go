package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

func reposTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {}
}`
	type args struct{}
	return New("repos",
		"List the indexed repositories (key + root). Pass a key as `repo` to other tools.",
		schema,
		func(_ context.Context, _ args) (any, error) {
			return ws.Repos(), nil
		})
}

func grepTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "pattern": {"type": "string", "description": "literal text or regex to search for"},
    "literal": {"type": "boolean", "description": "fixed-string match (default false = regex)"},
    "repo": {"type": "string", "description": "repo key (see the repos tool; default = the single indexed repo)"},
    "path_glob": {"type": "string", "description": "restrict to files matching this glob"},
    "limit": {"type": "integer", "description": "max matches"}
  },
  "required": ["pattern"]
}`
	type args struct {
		Pattern  string `json:"pattern"`
		Literal  bool   `json:"literal"`
		Repo     string `json:"repo"`
		PathGlob string `json:"path_glob"`
		Limit    int    `json:"limit"`
	}
	return New("grep",
		"Literal/regex search over real files; returns repo/path/line matches.",
		schema,
		func(ctx context.Context, a args) (any, error) {
			return ws.Grep(ctx, a.Pattern, a.Literal, a.Repo, a.PathGlob, a.Limit)
		})
}

func globTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "pattern": {"type": "string", "description": "glob, supports **"},
    "repo": {"type": "string", "description": "repo key (default root)"},
    "limit": {"type": "integer", "description": "max files"}
  },
  "required": ["pattern"]
}`
	type args struct {
		Pattern string `json:"pattern"`
		Repo    string `json:"repo"`
		Limit   int    `json:"limit"`
	}
	return New("glob",
		"Find files by glob pattern (supports **).",
		schema,
		func(ctx context.Context, a args) (any, error) {
			return ws.Glob(ctx, a.Pattern, a.Repo, a.Limit)
		})
}

func readFileTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative path"},
    "start_line": {"type": "integer", "description": "1-based start (omit for top)"},
    "end_line": {"type": "integer", "description": "1-based inclusive end (omit for end)"}
  },
  "required": ["path"]
}`
	type args struct {
		Repo      string `json:"repo"`
		Path      string `json:"path"`
		StartLine uint32 `json:"start_line"`
		EndLine   uint32 `json:"end_line"`
	}
	return New("read_file",
		"Read a file, optionally a line range.",
		schema,
		func(_ context.Context, a args) (any, error) {
			return ws.ReadFile(a.Repo, a.Path, a.StartLine, a.EndLine)
		})
}

func listDirTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative dir (omit for root)"}
  }
}`
	type args struct {
		Repo string `json:"repo"`
		Path string `json:"path"`
	}
	return New("list_dir",
		"List a directory's immediate entries.",
		schema,
		func(_ context.Context, a args) (any, error) {
			return ws.ListDir(a.Repo, a.Path)
		})
}

func treeTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative subpath (omit for root)"},
    "max_depth": {"type": "integer", "description": "recursion depth (default 3)"}
  }
}`
	type args struct {
		Repo     string `json:"repo"`
		Path     string `json:"path"`
		MaxDepth int    `json:"max_depth"`
	}
	return New("tree",
		"Recursive directory tree of a repo subpath (bounded depth).",
		schema,
		func(_ context.Context, a args) (any, error) {
			return ws.Tree(a.Repo, a.Path, a.MaxDepth)
		})
}
