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

	return New("repos",
		"List the indexed repositories (key + root). Pass a key as `repo` to other tools.",
		schema,
		func(_ context.Context, _ reposArgs) (any, error) {
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

	return New("grep",
		"Case-sensitive exact text or regex search over real files; returns repo/path/line matches. "+
			"Use for symbols, routes, table names, config keys, queue or event names, endpoints, and imports. "+
			"Set literal: true for plain text; otherwise the pattern is a regex. "+
			"In multi-repo mode pass the exact repo key; path_glob matches paths inside that repo, so use **/name/** for a directory, not the repo key. "+
			"If a plausible search returns nothing, retry once with fewer constraints or a case-insensitive regex such as (?i)rollups.",
		schema,
		func(ctx context.Context, a grepArgs) (any, error) {
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

	return New("glob",
		"Find files by glob pattern (supports **).",
		schema,
		func(ctx context.Context, a globArgs) (any, error) {
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

	return New("read_file",
		"Read a file, optionally a line range. Use for surrounding context, imports, "+
			"or lines outside indexed chunk boundaries; prefer get_chunk for a whole indexed chunk.",
		schema,
		func(_ context.Context, a readFileArgs) (any, error) {
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

	return New("list_dir",
		"List a directory's immediate entries.",
		schema,
		func(_ context.Context, a listDirArgs) (any, error) {
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

	return New("tree",
		"Recursive directory tree of a repo subpath (bounded depth).",
		schema,
		func(_ context.Context, a treeArgs) (any, error) {
			return ws.Tree(a.Repo, a.Path, a.MaxDepth)
		})
}
