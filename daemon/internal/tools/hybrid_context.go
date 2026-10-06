package tools

import (
	"context"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/search"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func enrichHybridContext(ctx context.Context, idx indexctl.Indexer, ws *workspace.Workspace, hits []search.HybridHit) {
	const maxPerHit = 2500
	remaining := 6000

	for i := 0; i < min(3, len(hits)) && remaining > 0; i++ {
		hit := &hits[i]
		body, startLine, matchLine, alreadyTruncated, ok := hybridContext(ctx, idx, ws, hit)
		if !ok {
			continue
		}

		maxChars := min(maxPerHit, remaining)
		text := []rune(body)
		from := 0
		if len(text) > maxChars {
			// Keep the matching line in view even when surrounding lines are huge.
			lines := strings.SplitAfter(body, "\n")

			for j := uint32(0); j < matchLine-startLine && int(j) < len(lines); j++ {
				from += len([]rune(lines[j]))
			}

			from = max(0, min(from-maxChars/3, len(text)-maxChars))
		}

		to := min(from+maxChars, len(text))
		hit.Context = string(text[from:to])
		hit.ContextStartLine = startLine + uint32(strings.Count(string(text[:from]), "\n"))
		hit.ContextEndLine = hit.ContextStartLine + uint32(strings.Count(hit.Context, "\n"))
		hit.ContextTruncated = alreadyTruncated || from > 0 || to < len(text)
		remaining -= to - from
	}
}

func hybridContext(ctx context.Context, idx indexctl.Indexer, ws *workspace.Workspace, hit *search.HybridHit) (string, uint32, uint32, bool, bool) {
	var body string
	var startLine, matchLine uint32
	var alreadyTruncated bool
	if hit.Hit.ID > 0 {
		detail, err := idx.GetChunk(ctx, hit.Hit.Repo, hit.Hit.ID)
		if err != nil || detail.Body == "" {
			return "", 0, 0, false, false
		}

		body, startLine, matchLine = detail.Body, detail.StartLine, detail.StartLine
		alreadyTruncated = detail.Truncated
	} else {
		line := hit.Hit.StartLine
		start := uint32(1)
		if line > 4 {
			start = line - 4
		}

		file, err := ws.ReadFile(hit.Hit.Repo, hit.Hit.Path, start, line+4)
		if err != nil {
			return "", 0, 0, false, false
		}

		body, startLine, matchLine = file.Content, file.StartLine, line
	}

	return body, startLine, matchLine, alreadyTruncated, true
}
