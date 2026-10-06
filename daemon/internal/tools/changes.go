package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/git"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func symbolTouchesHunk(start, end uint32, lines map[uint32]struct{}) bool {
	if len(lines) == 0 {
		return false
	}

	if start == 0 {
		return true
	}

	if end < start {
		end = start
	}

	for line := range lines {
		if line >= start && line <= end {
			return true
		}
	}
	return false
}

func changesDiff(ctx context.Context, ws *workspace.Workspace, a detectChangesArgs) (changeDiff, error) {
	base := a.Base
	if base == "" {
		base = "HEAD~1"
	}

	head := a.Head
	if head == "" {
		head = "HEAD"
	}

	depth := a.Depth
	if depth <= 0 {
		depth = 2
	}

	limit := a.Limit
	if limit <= 0 {
		limit = 40
	}

	root, err := ws.RepoRoot(a.Repo)
	if err != nil {
		return changeDiff{}, err
	}

	diffSpec := base + "..." + head
	fallback := ""
	hunkOut, err := git.Run(ctx, root, "diff", "-U0", diffSpec)
	if err != nil {
		// Honest fallback: working tree (staged+unstaged) vs HEAD.
		fallback = "working-tree-vs-HEAD"
		diffSpec = "HEAD"
		hunkOut, err = git.Run(ctx, root, "diff", "-U0", "HEAD")
		if err != nil {
			return changeDiff{}, err
		}
	}

	return changeDiff{base: base, head: head, spec: diffSpec, fallback: fallback, output: hunkOut, depth: depth, limit: limit}, nil
}

type pendingTrace struct {
	name, path string
}

type changeScan struct {
	res                      detectChangesResult
	directBudget             int
	seenDirect, seenIndirect map[string]struct{}
	traces                   []pendingTrace
}

func detectChanges(ctx context.Context, idx indexctl.Indexer, ws *workspace.Workspace, a detectChangesArgs) (any, error) {
	diff, err := changesDiff(ctx, ws, a)
	if err != nil {
		return nil, err
	}

	hunks := git.ParseDiffHunks(diff.output)
	paths := git.DiffPaths(hunks)
	res := detectChangesResult{Base: diff.base, Head: diff.head, DiffSpec: diff.spec, Fallback: diff.fallback, Paths: paths}
	limit := diff.limit
	directBudget := limit
	if directBudget > limit/2 && limit >= 4 {
		directBudget = limit / 2 // reserve room for transitive
	}

	scan := changeScan{res: res, directBudget: directBudget, seenDirect: map[string]struct{}{}, seenIndirect: map[string]struct{}{}}
	scan.collectDirect(ctx, idx, a, hunks)
	scan.collectIndirect(ctx, idx, a, diff.depth, limit)
	return scan.res, nil
}

type changeDiff struct {
	base, head, spec, fallback, output string
	depth, limit                       int
}
