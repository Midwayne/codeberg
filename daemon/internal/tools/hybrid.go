package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/search"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func hybridSearchTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {"type": "string", "description": "natural-language search query"},
    "k": {"type": "integer", "description": "max results (default 8)"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "path_glob": {"type": "string", "description": "fnmatch glob on chunk paths"},
    "kind": {"type": "string", "description": "` + chunkKindFilterDesc + `; lexical lines must belong to an indexed chunk of this kind"},
    "min_score": {"type": "number", "description": "minimum vector similarity score (0-1); lexical matches are independent"}
  },
  "required": ["query"]
}`

	return New("hybrid_search",
		"Fuse semantic chunks with independent exact-text matches and bounded context for top hits. Lexical-only hits have id=0; use read_file for more context.",
		schema,
		func(ctx context.Context, a searchArgs) (any, error) {
			return runHybridSearch(ctx, idx, ws, a)
		})
}

func runHybridSearch(ctx context.Context, idx indexctl.Indexer, ws *workspace.Workspace, a searchArgs) (any, error) {
	k := a.K
	if k <= 0 {
		k = 8
	}

	if k > 64 {
		k = 64
	}

	candidates, searchErr := idx.Search(ctx, indexctl.SearchOptions{
		Query:    a.Query,
		K:        min(k*2, 64),
		Repo:     a.Repo,
		PathGlob: a.PathGlob,
		Kind:     a.Kind,
		MinScore: a.MinScore,
	})
	if searchErr != nil {
		ie, ok := indexctl.AsIndexerError(searchErr)
		if !ok || ie.Code != "NOT_IMPLEMENTED" {
			return nil, searchErr
		}
	}

	matches, err := hybridLexicalMatches(ctx, ws, idx, a, min(k*4, 64))
	if err != nil {
		return nil, err
	}

	if searchErr != nil && len(matches) == 0 {
		return nil, searchErr
	}

	hits := search.Fuse(candidates, matches, k, a.Query)
	enrichHybridContext(ctx, idx, ws, hits)
	return hits, nil
}
