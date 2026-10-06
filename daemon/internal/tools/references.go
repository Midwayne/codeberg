package tools

import (
	"context"
	"fmt"
	"regexp"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

// findReferencesResult is graph-first when possible, with grep fallback.
type findReferencesResult struct {
	Source  string                `json:"source"` // "graph" or "grep"
	Graph   []indexctl.GraphEdge  `json:"graph,omitempty"`
	Matches []workspace.GrepMatch `json:"matches,omitempty"`
}

func findReferencesTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "symbol": {"type": "string", "description": "symbol name to find references for"},
    "repo": {"type": "string", "description": "repo key"},
    "path_prefix": {"type": "string", "description": "restrict graph lookup to nodes under this path prefix"},
    "path_glob": {"type": "string", "description": "restrict grep fallback to files matching glob"},
    "limit": {"type": "integer", "description": "max matches (default 50)"}
  },
  "required": ["symbol"]
}`

	return New("find_references",
		"Find usages of a symbol: prefers knowledge-graph edges (with resolution/confidence), falls back to word-boundary grep.",
		schema,
		func(ctx context.Context, a findReferencesArgs) (any, error) {
			limit := a.Limit
			if limit <= 0 {
				limit = 50
			}

			edges, err := idx.GraphRefs(ctx, indexctl.GraphRefsOptions{
				Name:       a.Symbol,
				Repo:       a.Repo,
				PathPrefix: a.PathPrefix,
				Limit:      limit,
			})
			if err == nil && len(edges) > 0 {
				return findReferencesResult{Source: "graph", Graph: edges}, nil
			}

			pattern := fmt.Sprintf(`\b%s\b`, regexp.QuoteMeta(a.Symbol))
			matches, gerr := ws.Grep(ctx, pattern, false, a.Repo, a.PathGlob, limit)
			if gerr != nil {
				if err != nil {
					return nil, err
				}
				return nil, gerr
			}
			return findReferencesResult{Source: "grep", Matches: matches}, nil
		})
}
