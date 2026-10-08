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
    "path_glob": {"type": "string", "description": "rg-style glob on chunk paths, e.g. daemon/** or *.go (matches at any depth)"},
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

	vectors := startVectorCandidates(ctx, idx, a, min(k*2, 64))
	matches, lexicalErr := hybridLexicalMatches(ctx, ws, idx, a, min(k*4, 64))

	result := <-vectors
	candidates, searchErr := result.hits, result.err
	if searchErr != nil && !vectorsUnavailable(searchErr) {
		return nil, searchErr
	}

	if lexicalErr != nil {
		return nil, lexicalErr
	}

	if searchErr != nil && len(matches) == 0 {
		return nil, searchErr
	}

	hits := search.Fuse(candidates, matches, k, a.Query)
	enrichHybridContext(ctx, idx, ws, hits)
	return hits, nil
}

type vectorCandidates struct {
	hits []indexctl.SearchResult
	err  error
}

// startVectorCandidates runs the vector half on its own goroutine so the
// indexer's embedding and ANN search overlap with the rg subprocess.
func startVectorCandidates(ctx context.Context, idx indexctl.Indexer, a searchArgs, k int) <-chan vectorCandidates {
	out := make(chan vectorCandidates, 1)

	go func() {
		hits, err := idx.Search(ctx, indexctl.SearchOptions{
			Query:    a.Query,
			K:        k,
			Repo:     a.Repo,
			PathGlob: a.PathGlob,
			Kind:     a.Kind,
			MinScore: a.MinScore,
		})
		out <- vectorCandidates{hits: hits, err: err}
	}()

	return out
}

func vectorsUnavailable(err error) bool {
	ie, ok := indexctl.AsIndexerError(err)
	return ok && ie.Code == "NOT_IMPLEMENTED"
}
