package search

import (
	"slices"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

// HybridHit is a vector chunk or lexical line ranked by fused evidence.
type HybridHit struct {
	Hit              indexctl.SearchResult `json:"hit"`
	GrepBoost        int                   `json:"grep_boost"`
	MatchLine        uint32                `json:"match_line,omitempty"`
	FinalScore       float32               `json:"final_score"`
	Context          string                `json:"context,omitempty"`
	ContextStartLine uint32                `json:"context_start_line,omitempty"`
	ContextEndLine   uint32                `json:"context_end_line,omitempty"`
	ContextTruncated bool                  `json:"context_truncated,omitempty"`
}

type rankedHit struct {
	hit         indexctl.SearchResult
	vectorRank  int
	lexicalRank int
	grepBoost   int
	matchLine   uint32 // best-ranked lexical line inside this hit
}

// Fuse combines independently retrieved vector chunks and lexical lines using
// reciprocal ranks. A grep line inside a vector chunk reinforces that chunk;
// otherwise it remains a citeable, lexical-only hit (id=0) for read_file.
func Fuse(vectors []indexctl.SearchResult, matches []workspace.GrepMatch, k int, query string) []HybridHit {
	items, vectorFiles := rankVectors(vectors)
	items = rankLexical(items, matches, vectorFiles, query)
	out := scoreHits(items, query)
	slices.SortStableFunc(out, func(a, b HybridHit) int {
		if a.FinalScore > b.FinalScore {
			return -1
		}

		if a.FinalScore < b.FinalScore {
			return 1
		}
		return 0 // stable sort keeps each source's original rank on a tie
	})

	if k > 0 && len(out) > k {
		return diverseHits(out, k)
	}
	return out
}
