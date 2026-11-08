package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

// Graph and lexical evidence are both bounded and may be incomplete.
type findReferencesResult struct {
	Source       string                `json:"source"` // "graph", "grep", or "graph+grep"
	Graph        []indexctl.GraphEdge  `json:"graph,omitempty"`
	Matches      []workspace.GrepMatch `json:"matches,omitempty"`
	Partial      bool                  `json:"partial"`
	LimitReached bool                  `json:"limit_reached"`
	GraphError   string                `json:"graph_error,omitempty"`
	LexicalError string                `json:"lexical_error,omitempty"`
}

func findReferencesTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "symbol": {"type": "string", "description": "exact symbol spelling; graph lookup and case-sensitive word-boundary text search use this name"},
    "repo": {"type": "string", "description": "target repo key; omitted searches all configured roots. Incoming graph callers may be in another repo; lexical lookup uses this repo when supplied"},
    "path_prefix": {"type": "string", "description": "target definition's relative file path or directory prefix; affects graph lookup, not lexical matches"},
    "path_glob": {"type": "string", "description": "restrict lexical evidence to files matching glob"},
    "limit": {"type": "integer", "description": "combined result limit (default 50, maximum 200)"}
  },
  "required": ["symbol"]
}`

	return New("find_references",
		"Find possible usages of a known symbol when you need broader coverage than a call trace. "+
			"Combines graph relationships with additional word-boundary text matches, including unresolved uses; text may also contain declarations or comments. "+
			"Use repo/path_prefix to narrow the graph target; omit repo to search all configured roots. Incoming graph callers may be in another repo. "+
			"Returns graph, matches, partial, limit_reached, and per-source errors. Results are always partial; empty results do not establish that a symbol is unused. Works without embeddings.",
		schema,
		func(ctx context.Context, a findReferencesArgs) (any, error) {
			return collectReferences(ctx, idx, ws, a)
		})
}

type findReferencesArgs struct {
	Symbol     string `json:"symbol"`
	Repo       string `json:"repo"`
	PathPrefix string `json:"path_prefix"`
	PathGlob   string `json:"path_glob"`
	Limit      int    `json:"limit"`
}
