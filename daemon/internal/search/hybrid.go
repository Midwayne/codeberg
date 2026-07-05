package search

import (
	"context"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

// HybridHit is a vector hit reranked with a lexical grep boost.
type HybridHit struct {
	Hit        indexctl.SearchResult
	GrepBoost  int
	FinalScore float32
}

// TermMatcher returns true when term appears in the given file.
type TermMatcher func(ctx context.Context, term, repo, path string) (bool, error)

// Hybrid reranks vector candidates by boosting scores when query terms grep-match hit files.
func Hybrid(ctx context.Context, candidates []indexctl.SearchResult, query string, match TermMatcher, k int) ([]HybridHit, error) {
	terms := SignificantTerms(query)
	out := make([]HybridHit, 0, len(candidates))

	for _, hit := range candidates {
		boost := 0

		if len(terms) > 0 {
			for _, term := range terms {
				ok, err := match(ctx, term, hit.Repo, hit.Path)
				if err != nil {
					return nil, err
				}
				if ok {
					boost++
				}
			}
		}

		final := hit.Score + float32(boost)*0.05
		out = append(out, HybridHit{Hit: hit, GrepBoost: boost, FinalScore: final})
	}

	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j].FinalScore > out[j-1].FinalScore; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}

	if k > 0 && len(out) > k {
		out = out[:k]
	}

	return out, nil
}

// SignificantTerms extracts searchable tokens from a natural-language query.
func SignificantTerms(query string) []string {
	stop := map[string]bool{
		"the": true, "a": true, "an": true, "is": true, "are": true, "was": true,
		"where": true, "how": true, "what": true, "which": true, "does": true,
		"do": true, "in": true, "of": true, "to": true, "for": true, "and": true,
		"or": true, "with": true, "from": true, "by": true, "on": true, "at": true,
	}

	var terms []string
	for _, w := range strings.Fields(strings.ToLower(query)) {
		w = strings.Trim(w, ".,;:!?\"'()[]{}")
		if len(w) < 3 || stop[w] {
			continue
		}
		terms = append(terms, w)
	}

	return terms
}

// RegexpQuote escapes a string for use in a literal grep pattern.
func RegexpQuote(s string) string {
	const specials = `\.+*?()|[]{}^$`
	var b strings.Builder

	for _, r := range s {
		if strings.ContainsRune(specials, r) {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}

	return b.String()
}
