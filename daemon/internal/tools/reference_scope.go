package tools

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func referenceMatches(ctx context.Context, ws *workspace.Workspace, args findReferencesArgs, limit int) ([]workspace.GrepMatch, error) {
	pattern := fmt.Sprintf(`\b%s\b`, regexp.QuoteMeta(args.Symbol))
	var matches []workspace.GrepMatch
	var failures []error

	for _, repo := range ws.Repos() {
		if args.Repo != "" && args.Repo != repo.Key {
			continue
		}

		hits, err := ws.Grep(ctx, pattern, false, repo.Key, args.PathGlob, limit-len(matches))
		matches = append(matches, hits...)
		if err != nil {
			failures = append(failures, fmt.Errorf("%s: %w", repo.Key, err))
		}
		if len(matches) >= limit {
			break
		}
	}

	return matches, errors.Join(failures...)
}

func qualifyReferences(edges []indexctl.GraphEdge, ws *workspace.Workspace, selected string) {
	repos := ws.Repos()
	if selected == "" && len(repos) == 1 {
		selected = repos[0].Key
	}

	for i := range edges {
		if edges[i].SrcRepo == "" {
			edges[i].SrcRepo = selected
		}
		if edges[i].DstRepo == "" {
			edges[i].DstRepo = selected
		}
	}
}
