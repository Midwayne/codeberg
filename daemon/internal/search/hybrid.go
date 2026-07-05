package search

import (
	"context"
	"slices"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

// HybridHit is a vector hit reranked with a lexical grep boost.
type HybridHit struct {
	Hit        indexctl.SearchResult `json:"hit"`
	GrepBoost  int                   `json:"grep_boost"`
	FinalScore float32               `json:"final_score"`
}

// ContentReader loads repo-relative file bytes for hybrid term checks.
type ContentReader func(ctx context.Context, repo, path string) ([]byte, error)

var stopWords = map[string]bool{
	"the": true, "a": true, "an": true, "is": true, "are": true, "was": true,
	"where": true, "how": true, "what": true, "which": true, "does": true,
	"do": true, "in": true, "of": true, "to": true, "for": true, "and": true,
	"or": true, "with": true, "from": true, "by": true, "on": true, "at": true,
}

func termBoost(lower string, terms []string) int {
	boost := 0
	for _, term := range terms {
		if strings.Contains(lower, term) {
			boost++
		}
	}
	return boost
}

// Hybrid reranks vector candidates by boosting scores when query terms appear in
// the hit chunk (snippet, symbol, path) and, when that yields no signal, in the
// full file as a fallback.
func Hybrid(ctx context.Context, candidates []indexctl.SearchResult, query string, read ContentReader, k int) ([]HybridHit, error) {
	terms := SignificantTerms(query)
	out := make([]HybridHit, 0, len(candidates))
	contentCache := make(map[string]string)

	for _, hit := range candidates {
		boost := 0

		if len(terms) > 0 {
			chunkText := strings.ToLower(strings.Join([]string{hit.Path, hit.Symbol, hit.Snippet}, "\n"))
			boost = termBoost(chunkText, terms)

			if boost == 0 && read != nil {
				key := hit.Repo + "\x00" + hit.Path
				lower, ok := contentCache[key]
				if !ok {
					body, err := read(ctx, hit.Repo, hit.Path)
					if err != nil {
						return nil, err
					}
					lower = strings.ToLower(string(body))
					contentCache[key] = lower
				}
				boost = termBoost(lower, terms)
			}
		}

		final := hit.Score + float32(boost)*0.05
		out = append(out, HybridHit{Hit: hit, GrepBoost: boost, FinalScore: final})
	}

	slices.SortFunc(out, func(a, b HybridHit) int {
		switch {
		case a.FinalScore > b.FinalScore:
			return -1
		case a.FinalScore < b.FinalScore:
			return 1
		default:
			return 0
		}
	})

	if k > 0 && len(out) > k {
		out = out[:k]
	}

	return out, nil
}

// SignificantTerms extracts searchable tokens from a natural-language query.
func SignificantTerms(query string) []string {
	var terms []string
	for _, w := range strings.Fields(strings.ToLower(query)) {
		w = strings.Trim(w, ".,;:!?\"'()[]{}")
		if len(w) < 3 || stopWords[w] {
			continue
		}
		terms = append(terms, w)
	}

	return terms
}
