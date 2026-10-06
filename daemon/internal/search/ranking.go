package search

import (
	"fmt"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

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

func rankVectors(vectors []indexctl.SearchResult) ([]*rankedHit, map[string]bool) {
	items := make([]*rankedHit, 0, len(vectors))
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

	return items, vectorFiles
}

func scoreHits(items []*rankedHit, query string) []HybridHit {
	const rrfOffset = 60.0
	const lexicalWeight = 1.01 // prefer a same-rank exact match without drowning vector hits
	const fileWeight = 0.3     // supporting evidence elsewhere in the same file, not the same chunk
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

	return out
}

func diverseHits(out []HybridHit, k int) []HybridHit {
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
