package search

import (
	"regexp"
	"slices"
	"strings"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

var stopWords = map[string]bool{
	"the": true, "a": true, "an": true, "is": true, "are": true, "was": true,
	"where": true, "how": true, "what": true, "which": true, "does": true,
	"do": true, "in": true, "of": true, "to": true, "for": true, "and": true,
	"or": true, "with": true, "from": true, "by": true, "on": true, "at": true,
}

var testQuery = regexp.MustCompile(`(?i)\b(tests?|specs?|generated|build)\b`)

// PrioritizeLexical sorts grep results deterministically (rg can emit files in
// parallel), and prevents generated artifacts and test fixtures from crowding
// out production code unless the query explicitly asks for them.
func PrioritizeLexical(matches []workspace.GrepMatch, query string) []workspace.GrepMatch {
	if len(matches) < 2 {
		return matches
	}

	request := strings.ToLower(testQuery.FindString(query))

	ordered := append([]workspace.GrepMatch(nil), matches...)
	slices.SortStableFunc(ordered, func(a, b workspace.GrepMatch) int {
		if pa, pb := lexicalPriority(a.Path, request), lexicalPriority(b.Path, request); pa != pb {
			return pa - pb
		}

		if repo := strings.Compare(a.Repo, b.Repo); repo != 0 {
			return repo
		}

		if path := strings.Compare(a.Path, b.Path); path != 0 {
			return path
		}

		switch {
		case a.Line < b.Line:
			return -1
		case a.Line > b.Line:
			return 1
		default:
			return 0
		}
	})
	return ordered
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

// LexicalPattern picks the most distinctive query term for an independent
// file search. Quote it before sending it to rg: identifiers and config keys
// can include regex metacharacters.
func LexicalPattern(query string) string {
	terms := SignificantTerms(query)
	if len(terms) == 0 {
		return ""
	}

	var codeTerm string

	for _, raw := range strings.Fields(query) {
		term := strings.Trim(raw, ".,;:!?\"'()[]{}")
		if len(term) < 3 {
			continue
		}

		if strings.ContainsAny(term, "_-0123456789") || strings.IndexAny(term[1:], "ABCDEFGHIJKLMNOPQRSTUVWXYZ") >= 0 {
			if len(term) > len(codeTerm) {
				codeTerm = term
			}
		}
	}

	best := terms[0]

	for _, term := range terms[1:] {
		if len(term) > len(best) {
			best = term
		}
	}

	if codeTerm != "" {
		best = strings.ToLower(codeTerm)
	}
	return `(?i)\b` + regexp.QuoteMeta(best) + `\b`
}

func lexicalPriority(path, request string) int {
	p := "/" + strings.ToLower(path)
	generated := strings.Contains(p, "/build/") || strings.Contains(p, "/generated/") ||
		strings.Contains(p, "/target/") || strings.Contains(p, "/node_modules/")
	test := strings.Contains(p, "/src/test/") || strings.Contains(p, "/tests/") ||
		strings.Contains(p, "/test/") || strings.HasSuffix(p, "_test.go") ||
		strings.HasSuffix(p, ".spec.ts")
	main := strings.Contains(p, "/src/main/")

	switch {
	case generated:
		if request == "generated" || request == "build" {
			return 0
		}
		return 3
	case test:
		if request == "test" || request == "tests" || request == "spec" || request == "specs" {
			return 0
		}
		return 2
	case main:
		return 1
	default:
		return 1
	}
}
