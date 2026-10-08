package search

import (
	"fmt"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

type lexicalRanking struct {
	items                []*rankedHit
	seenLines, seenFiles map[string]bool
	rank                 int
}

func rankLexical(items []*rankedHit, matches []workspace.GrepMatch, vectorFiles map[string]bool, query string) []*rankedHit {
	r := lexicalRanking{items: items, seenLines: make(map[string]bool), seenFiles: make(map[string]bool)}

	for _, match := range matches {
		if match.Repo == "" || match.Path == "" || match.Line == 0 {
			continue
		}

		fileKey := match.Repo + "\x00" + match.Path
		text := strings.TrimSpace(match.Text)
		if vectorFiles[fileKey] && !strings.Contains(strings.ToLower(query), "import") &&
			!strings.Contains(strings.ToLower(query), "include") &&
			(strings.HasPrefix(text, "import ") || strings.HasPrefix(text, "from ") ||
				strings.HasPrefix(text, "#include ") || strings.HasPrefix(text, "package ")) {
			continue
		}

		lineKey := fmt.Sprintf("%s\x00%d", fileKey, match.Line)
		if r.seenLines[lineKey] {
			continue
		}

		r.seenLines[lineKey] = true
		r.add(match, fileKey)
	}
	return r.items
}

func (r *lexicalRanking) add(match workspace.GrepMatch, fileKey string) {
	var overlapping *rankedHit

	for _, item := range r.items {
		if item.vectorRank > 0 && item.hit.Repo == match.Repo && item.hit.Path == match.Path &&
			match.Line >= item.hit.StartLine && match.Line <= item.hit.EndLine {
			overlapping = item
			break
		}
	}

	if overlapping != nil {
		if overlapping.lexicalRank == 0 {
			r.rank++
			overlapping.lexicalRank = r.rank
			overlapping.matchLine = match.Line
		}

		overlapping.grepBoost++
		return
	}

	if r.seenFiles[fileKey] {
		return
	}

	r.seenFiles[fileKey] = true
	preview := []rune(match.Text)
	if len(preview) > 400 {
		preview = preview[:400]
	}

	r.rank++
	item := &rankedHit{
		hit: indexctl.SearchResult{
			Repo: match.Repo, Path: match.Path, StartLine: match.Line, EndLine: match.Line,
			Snippet: string(preview),
		},
		lexicalRank: r.rank, grepBoost: 1, matchLine: match.Line,
	}
	r.items = append(r.items, item)
}
