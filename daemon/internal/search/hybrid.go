package search

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

// HybridHit is a vector chunk or lexical line ranked by fused evidence.
type HybridHit struct {
	Hit              indexctl.SearchResult `json:"hit"`
	GrepBoost        int                   `json:"grep_boost"`
	FinalScore       float32               `json:"final_score"`
	Context          string                `json:"context,omitempty"`
	ContextStartLine uint32                `json:"context_start_line,omitempty"`
	ContextEndLine   uint32                `json:"context_end_line,omitempty"`
	ContextTruncated bool                  `json:"context_truncated,omitempty"`
}

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
	priority := func(path string) int {
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
	ordered := append([]workspace.GrepMatch(nil), matches...)
	slices.SortStableFunc(ordered, func(a, b workspace.GrepMatch) int {
		if pa, pb := priority(a.Path), priority(b.Path); pa != pb {
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

type rankedHit struct {
	hit         indexctl.SearchResult
	vectorRank  int
	lexicalRank int
	grepBoost   int
}

// Fuse combines independently retrieved vector chunks and lexical lines using
// reciprocal ranks. A grep line inside a vector chunk reinforces that chunk;
// otherwise it remains a citeable, lexical-only hit (id=0) for read_file.
func Fuse(vectors []indexctl.SearchResult, matches []workspace.GrepMatch, k int, query string) []HybridHit {
	const rrfOffset = 60.0
	const lexicalWeight = 1.01 // prefer a same-rank exact match without drowning vector hits
	const fileWeight = 0.3     // supporting evidence elsewhere in the same file, not the same chunk
	items := make([]*rankedHit, 0, len(vectors)+len(matches))
	seen := make(map[string]*rankedHit)
	vectorFiles := make(map[string]bool)
	for i, hit := range vectors {
		key := hit.Repo + "\x00" + hit.Path + "\x00" + fmt.Sprintf("%d", hit.ID)
		if _, ok := seen[key]; ok {
			continue
		}
		item := &rankedHit{hit: hit, vectorRank: i + 1}
		items = append(items, item)
		seen[key] = item
		vectorFiles[hit.Repo+"\x00"+hit.Path] = true
	}
	seenLines := make(map[string]bool)
	seenFiles := make(map[string]bool)
	lexicalRank := 0
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
		if seenLines[lineKey] {
			continue
		}
		seenLines[lineKey] = true
		var overlapping *rankedHit
		for _, item := range items {
			if item.vectorRank > 0 && item.hit.Repo == match.Repo && item.hit.Path == match.Path &&
				match.Line >= item.hit.StartLine && match.Line <= item.hit.EndLine {
				overlapping = item
				break
			}
		}
		if overlapping != nil {
			if overlapping.lexicalRank == 0 {
				lexicalRank++
				overlapping.lexicalRank = lexicalRank
			}
			overlapping.grepBoost++
			continue
		}
		if seenFiles[fileKey] {
			continue
		}
		seenFiles[fileKey] = true
		preview := []rune(match.Text)
		if len(preview) > 400 {
			preview = preview[:400]
		}
		lexicalRank++
		item := &rankedHit{
			hit: indexctl.SearchResult{
				Repo: match.Repo, Path: match.Path, StartLine: match.Line, EndLine: match.Line,
				Snippet: string(preview),
			},
			lexicalRank: lexicalRank, grepBoost: 1,
		}
		items = append(items, item)
	}
	vectorFileRank := make(map[string]int)
	lexicalFileRank := make(map[string]int)
	for _, item := range items {
		key := item.hit.Repo + "\x00" + item.hit.Path
		if item.vectorRank > 0 && (vectorFileRank[key] == 0 || item.vectorRank < vectorFileRank[key]) {
			vectorFileRank[key] = item.vectorRank
		}
		if item.lexicalRank > 0 && (lexicalFileRank[key] == 0 || item.lexicalRank < lexicalFileRank[key]) {
			lexicalFileRank[key] = item.lexicalRank
		}
	}
	out := make([]HybridHit, 0, len(items))
	for _, item := range items {
		key := item.hit.Repo + "\x00" + item.hit.Path
		var score float64
		if item.vectorRank > 0 {
			score += 1 / (rrfOffset + float64(item.vectorRank))
			if rank := lexicalFileRank[key]; rank > 0 {
				score += fileWeight * lexicalWeight / (rrfOffset + float64(rank))
			}
		}
		if item.lexicalRank > 0 && item.vectorRank == 0 {
			score += lexicalWeight / (rrfOffset + float64(item.lexicalRank))
			if rank := vectorFileRank[key]; rank > 0 {
				score += fileWeight / (rrfOffset + float64(rank))
			}
		}
		out = append(out, HybridHit{Hit: item.hit, GrepBoost: item.grepBoost, FinalScore: float32(score * sourceWeight(item.hit.Path, query))})
	}
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
		// Favor distinct files before a fourth hit from any one file. If a
		// file-scoped query has fewer alternatives, fill the remaining slots.
		diverse := make([]HybridHit, 0, k)
		var deferred []HybridHit
		fileCounts := make(map[string]int)
		for _, hit := range out {
			key := hit.Hit.Repo + "\x00" + hit.Hit.Path
			if fileCounts[key] >= 3 {
				deferred = append(deferred, hit)
				continue
			}
			diverse = append(diverse, hit)
			fileCounts[key]++
			if len(diverse) == k {
				return diverse
			}
		}
		for _, hit := range deferred {
			diverse = append(diverse, hit)
			if len(diverse) == k {
				break
			}
		}
		return diverse
	}
	return out
}

func sourceWeight(path, query string) float64 {
	p := "/" + strings.ToLower(path)
	request := strings.ToLower(testQuery.FindString(query))
	if strings.Contains(p, "/build/") || strings.Contains(p, "/generated/") ||
		strings.Contains(p, "/target/") || strings.Contains(p, "/node_modules/") {
		if request == "generated" || request == "build" {
			return 1.05
		}
		return 0.9
	}
	if strings.Contains(p, "/src/test/") || strings.Contains(p, "/tests/") ||
		strings.Contains(p, "/test/") || strings.HasSuffix(p, "_test.go") || strings.HasSuffix(p, ".spec.ts") {
		if request == "test" || request == "tests" || request == "spec" || request == "specs" {
			return 1.05
		}
		return 0.85
	}
	return 1
}
