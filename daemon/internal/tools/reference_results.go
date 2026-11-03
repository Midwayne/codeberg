package tools

import (
	"context"
	"errors"
	"fmt"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func collectReferences(ctx context.Context, idx indexctl.Indexer, ws *workspace.Workspace, args findReferencesArgs) (any, error) {
	limit := args.Limit
	if limit <= 0 {
		limit = 50
	}

	limit = min(limit, 200)
	if args.Repo != "" {
		key, err := ws.ResolveRepo(args.Repo)
		if err != nil {
			return nil, err
		}
		args.Repo = key
	}
	edges, graphErr := idx.GraphRefs(ctx, indexctl.GraphRefsOptions{
		Name: args.Symbol, Repo: args.Repo, PathPrefix: args.PathPrefix, Limit: limit,
	})
	matches, lexicalErr := referenceMatches(ctx, ws, args, limit)
	if lexicalErr != nil && len(matches) == 0 && len(edges) == 0 {
		return nil, errors.Join(graphErr, lexicalErr)
	}

	qualifyReferences(edges, ws, args.Repo)
	result := combineReferences(edges, matches, limit)
	result.LimitReached = result.LimitReached || errors.Is(graphErr, indexctl.ErrTruncated)
	if graphErr != nil {
		result.GraphError = graphErr.Error()
	}
	if lexicalErr != nil {
		result.LexicalError = lexicalErr.Error()
	}

	return result, nil
}

func combineReferences(edges []indexctl.GraphEdge, matches []workspace.GrepMatch, limit int) findReferencesResult {
	result := findReferencesResult{Source: "grep", Partial: true,
		LimitReached: len(edges) >= limit || len(matches) >= limit}
	result.Graph = edges[:min(len(edges), limit)]
	seen := make(map[string]bool)

	for _, edge := range result.Graph {
		seen[fmt.Sprintf("%s:%s:%d", edge.SrcRepo, edge.SrcPath, edge.Line)] = true
	}

	for _, match := range matches {
		key := fmt.Sprintf("%s:%s:%d", match.Repo, match.Path, match.Line)
		if seen[key] {
			continue
		}

		if len(result.Graph)+len(result.Matches) == limit {
			result.LimitReached = true
			break
		}

		result.Matches = append(result.Matches, match)
		seen[key] = true
	}

	if len(result.Graph) > 0 {
		result.Source = "graph"
		if len(result.Matches) > 0 {
			result.Source = "graph+grep"
		}
	}

	return result
}
