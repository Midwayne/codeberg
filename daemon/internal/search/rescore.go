package search

import (
	"context"
	"slices"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

const (
	// RescorePool is how many dense candidates are fetched for keyword
	// rescoring: the indexer's per-search cap.
	RescorePool = 64
	// rescoreDenseWeight is the dense share of the fused score. It was chosen
	// on the doc-comment benchmark and validated on the hard fixture; see
	// docs/benchmarks/code-search-techniques-2026-11-17.md.
	rescoreDenseWeight = 0.7
	defaultSearchK     = 10
)

// FileReader reads whole repository files; *workspace.Workspace satisfies it.
type FileReader interface {
	ReadRaw(repo, path string) ([]byte, error)
}

// Rescorer wraps an Indexer so semantic search also weighs exact code
// terms: it fetches a wider dense pool, scores each candidate's body with
// BM25 over identifier-split tokens, and orders by a convex mix of the two
// min-max-normalized scores. Hit scores stay the dense similarity.
type Rescorer struct {
	indexctl.Indexer
	files FileReader
}

func NewRescorer(idx indexctl.Indexer, files FileReader) *Rescorer {
	return &Rescorer{Indexer: idx, files: files}
}

func (r *Rescorer) Search(ctx context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	k := opts.K
	if k <= 0 {
		k = defaultSearchK
	}

	wide := opts
	wide.K = RescorePool
	hits, err := r.Indexer.Search(ctx, wide)
	if err != nil {
		return nil, err
	}

	query := QueryTokens(opts.Query)
	if len(hits) > 1 && len(query) > 0 {
		hits = fuseKeywordScores(hits, r.bodies(hits), query)
	}
	return hits[:min(k, len(hits))], nil
}

func fuseKeywordScores(hits []indexctl.SearchResult, bodies []string, query []string) []indexctl.SearchResult {
	docs := make([][]string, len(bodies))
	dense := make([]float64, len(hits))

	for i, body := range bodies {
		docs[i] = CodeTokens(body)
		dense[i] = float64(hits[i].Score)
	}

	lexical := normalize(poolBM25(docs, query))
	dense = normalize(dense)
	order := make([]int, len(hits))
	fused := make([]float64, len(hits))

	for i := range hits {
		order[i] = i
		fused[i] = rescoreDenseWeight*dense[i] + (1-rescoreDenseWeight)*lexical[i]
	}

	// Stable on ties, so equal evidence keeps the indexer's dense order.
	slices.SortStableFunc(order, func(a, b int) int {
		switch {
		case fused[a] > fused[b]:
			return -1
		case fused[a] < fused[b]:
			return 1
		}
		return 0
	})

	out := make([]indexctl.SearchResult, len(hits))
	for i, j := range order {
		out[i] = hits[j]
	}
	return out
}

// normalize maps scores to [0, 1]; a constant list maps to all zeros.
func normalize(v []float64) []float64 {
	lo, hi := slices.Min(v), slices.Max(v)
	out := make([]float64, len(v))
	if hi <= lo {
		return out
	}

	for i, x := range v {
		out[i] = (x - lo) / (hi - lo)
	}
	return out
}

// bodies returns each hit's full chunk lines, reading every file once. An
// unreadable file (deleted since indexing, too large) falls back to the
// hit's bounded snippet.
func (r *Rescorer) bodies(hits []indexctl.SearchResult) []string {
	files := make(map[string][]string)
	out := make([]string, len(hits))

	for i, h := range hits {
		key := h.Repo + "\x00" + h.Path
		lines, ok := files[key]
		if !ok {
			lines = r.readLines(h.Repo, h.Path)
			files[key] = lines
		}

		out[i] = h.Snippet
		if lines != nil && h.StartLine >= 1 && h.StartLine <= h.EndLine && int(h.StartLine) <= len(lines) {
			end := min(int(h.EndLine), len(lines))
			out[i] = strings.Join(lines[h.StartLine-1:end], "\n")
		}
	}
	return out
}

func (r *Rescorer) readLines(repo, path string) []string {
	raw, err := r.files.ReadRaw(repo, path)
	if err != nil {
		return nil
	}
	return strings.Split(string(raw), "\n")
}
