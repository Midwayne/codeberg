package search

import "math"

const (
	bm25K1 = 1.2
	bm25B  = 0.75
)

// poolBM25 scores each tokenized document against the query, with document
// frequencies taken from the pool itself (the dense candidates), so no global
// inverted index is needed. Repeated query terms count once.
func poolBM25(docs [][]string, query []string) []float64 {
	scores := make([]float64, len(docs))
	if len(docs) == 0 || len(query) == 0 {
		return scores
	}

	tf, df, avgLen := termStats(docs)
	n := float64(len(docs))
	seen := make(map[string]bool, len(query))

	for _, term := range query {
		if seen[term] || df[term] == 0 {
			continue
		}

		seen[term] = true
		idf := math.Log(1 + (n-df[term]+0.5)/(df[term]+0.5))

		for i, counts := range tf {
			f := counts[term]
			if f == 0 {
				continue
			}

			norm := bm25K1 * (1 - bm25B + bm25B*float64(len(docs[i]))/avgLen)
			scores[i] += idf * f * (bm25K1 + 1) / (f + norm)
		}
	}
	return scores
}

func termStats(docs [][]string) ([]map[string]float64, map[string]float64, float64) {
	tf := make([]map[string]float64, len(docs))
	df := make(map[string]float64)
	total := 0

	for i, doc := range docs {
		tf[i] = make(map[string]float64)
		for _, t := range doc {
			tf[i][t]++
		}

		for t := range tf[i] {
			df[t]++
		}
		total += len(doc)
	}

	return tf, df, math.Max(float64(total)/float64(len(docs)), 1)
}
