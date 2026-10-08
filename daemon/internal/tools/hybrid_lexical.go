package tools

import (
	"context"
	"fmt"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/search"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func hybridLexicalMatches(ctx context.Context, ws *workspace.Workspace, idx indexctl.Indexer, a searchArgs, limit int) ([]workspace.GrepMatch, error) {
	pattern := search.LexicalPattern(a.Query)
	if pattern == "" {
		return nil, nil
	}

	repos := []string{a.Repo}
	if a.Repo == "" {
		repos = nil

		for _, repo := range ws.Repos() {
			repos = append(repos, repo.Key)
		}
	}

	var matches []workspace.GrepMatch
	perRepo := limit
	if len(repos) > 1 {
		perRepo = max(1, limit/len(repos))
	}

	for _, repo := range repos {
		found, err := ws.GrepForRetrieval(ctx, pattern, repo, a.PathGlob, min(perRepo, limit-len(matches)))
		if err != nil {
			return nil, err
		}

		matches = append(matches, found...)
		if len(matches) >= limit {
			break
		}
	}

	if a.Kind == "" {
		return search.PrioritizeLexical(matches, a.Query), nil
	}

	filtered := filterLexicalKind(ctx, idx, matches, a.Kind)
	return search.PrioritizeLexical(filtered, a.Query), nil
}

func filterLexicalKind(ctx context.Context, idx indexctl.Indexer, matches []workspace.GrepMatch, requestedKind string) []workspace.GrepMatch {
	// A lexical line has no chunk kind. Resolve it against indexed spans only
	// when the caller requested a kind; omit untyped/unindexed lines then.
	filtered := make([]workspace.GrepMatch, 0, len(matches))
	outlines := make(map[string][]indexctl.SearchResult)
	kinds := make(map[string]string)

	for _, match := range matches {
		key := match.Repo + "\x00" + match.Path
		outline, ok := outlines[key]
		if !ok {
			outline, _ = idx.FileOutline(ctx, match.Repo, match.Path)
			outlines[key] = outline
		}

		for _, chunk := range outline {
			if match.Line < chunk.StartLine || match.Line > chunk.EndLine {
				continue
			}

			if strings.EqualFold(outlineChunkKind(ctx, idx, match.Repo, chunk, kinds), requestedKind) {
				filtered = append(filtered, match)
				break
			}
		}
	}
	return filtered
}

// outlineChunkKind prefers the kind carried on the outline hit and only falls
// back to fetching the chunk (memoized in kinds) for indexers that omit it.
func outlineChunkKind(ctx context.Context, idx indexctl.Indexer, repo string, chunk indexctl.SearchResult, kinds map[string]string) string {
	if chunk.Kind != "" {
		return chunk.Kind
	}

	chunkKey := fmt.Sprintf("%s\x00%d", repo, chunk.ID)
	if kind, ok := kinds[chunkKey]; ok {
		return kind
	}

	kind := ""
	if detail, err := idx.GetChunk(ctx, repo, chunk.ID); err == nil {
		kind = detail.Kind
	}

	kinds[chunkKey] = kind
	return kind
}
