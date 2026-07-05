package tools

import (
	"context"
	"fmt"
	"strings"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

// Indexer is the subset of indexctl used by search-related tools.
type Indexer interface {
	Search(ctx context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error)
	GetChunk(ctx context.Context, repo string, id uint64) (indexctl.ChunkDetail, error)
	FindSymbol(ctx context.Context, opts indexctl.SymbolOptions) ([]indexctl.SearchResult, error)
	FileOutline(ctx context.Context, repo, path string) ([]indexctl.SearchResult, error)
}

func registerIndexTools(r *Registry, idx Indexer, ws *workspace.Workspace) {
	r.Register(searchTool(idx))
	r.Register(getChunkTool(idx))
	r.Register(findSymbolTool(idx))
	r.Register(fileOutlineTool(idx))
	r.Register(hybridSearchTool(idx, ws))
	r.Register(findReferencesTool(ws))
}

func searchTool(idx Indexer) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {"type": "string", "description": "natural-language search query"},
    "k": {"type": "integer", "description": "max results (default 10)"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "path_glob": {"type": "string", "description": "fnmatch glob on chunk paths, e.g. daemon/*"},
    "kind": {"type": "string", "description": "chunk kind: function, method, class, struct, interface, window"},
    "min_score": {"type": "number", "description": "minimum similarity score (0-1)"}
  },
  "required": ["query"]
}`

	return New("search",
		"Semantic vector search over indexed code chunks. Returns path, symbol, lines, score, and snippet.",
		schema,
		func(ctx context.Context, a searchArgs) (any, error) {
			return idx.Search(ctx, indexctl.SearchOptions{
				Query:    a.Query,
				K:        a.K,
				Repo:     a.Repo,
				PathGlob: a.PathGlob,
				Kind:     a.Kind,
				MinScore: a.MinScore,
			})
		})
}

func getChunkTool(idx Indexer) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string", "description": "repo key from search results"},
    "id": {"type": "integer", "description": "chunk id from search results"}
  },
  "required": ["repo", "id"]
}`

	return New("get_chunk",
		"Fetch the full indexed chunk body for a search hit (repo + id). Prefer over read_file after search_code.",
		schema,
		func(ctx context.Context, a getChunkArgs) (any, error) {
			return idx.GetChunk(ctx, a.Repo, a.ID)
		})
}

func findSymbolTool(idx Indexer) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {"type": "string", "description": "symbol name to find"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "kind": {"type": "string", "description": "chunk kind filter"},
    "limit": {"type": "integer", "description": "max results (default 20)"}
  },
  "required": ["name"]
}`

	return New("find_symbol",
		"Exact symbol lookup in the chunk index (case-insensitive). Works without vector search.",
		schema,
		func(ctx context.Context, a findSymbolArgs) (any, error) {
			return idx.FindSymbol(ctx, indexctl.SymbolOptions{
				Name:  a.Name,
				Repo:  a.Repo,
				Kind:  a.Kind,
				Limit: a.Limit,
			})
		})
}

func fileOutlineTool(idx Indexer) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string", "description": "repo key"},
    "path": {"type": "string", "description": "file path relative to repo root"}
  },
  "required": ["repo", "path"]
}`

	return New("file_outline",
		"List indexed chunks (functions, classes, etc.) in a file with line ranges.",
		schema,
		func(ctx context.Context, a fileOutlineArgs) (any, error) {
			return idx.FileOutline(ctx, a.Repo, a.Path)
		})
}

func hybridSearchTool(idx Indexer, ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {"type": "string", "description": "natural-language search query"},
    "k": {"type": "integer", "description": "max results (default 8)"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "path_glob": {"type": "string", "description": "fnmatch glob on chunk paths"}
  },
  "required": ["query"]
}`

	return New("hybrid_search",
		"Vector search candidates reranked by grep verification of query terms in hit files.",
		schema,
		func(ctx context.Context, a hybridSearchArgs) (any, error) {
			k := a.K
			if k <= 0 {
				k = 8
			}

			candidates, err := idx.Search(ctx, indexctl.SearchOptions{
				Query:    a.Query,
				K:        k * 2,
				Repo:     a.Repo,
				PathGlob: a.PathGlob,
			})
			if err != nil {
				return nil, err
			}

			terms := significantTerms(a.Query)
			out := make([]hybridRanked, 0, len(candidates))

			for _, hit := range candidates {
				boost := 0
				if len(terms) > 0 {
					for _, term := range terms {
						matches, gerr := ws.Grep(ctx, term, true, hit.Repo, hit.Path, 3)
						if gerr == nil && len(matches) > 0 {
							boost++
						}
					}
				}

				final := hit.Score + float32(boost)*0.05
				out = append(out, hybridRanked{Hit: hit, GrepBoost: boost, FinalScore: final})
			}

			for i := 1; i < len(out); i++ {
				for j := i; j > 0 && out[j].FinalScore > out[j-1].FinalScore; j-- {
					out[j], out[j-1] = out[j-1], out[j]
				}
			}

			if len(out) > k {
				out = out[:k]
			}

			return out, nil
		})
}

func findReferencesTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "symbol": {"type": "string", "description": "symbol name to find references for"},
    "repo": {"type": "string", "description": "repo key"},
    "path_glob": {"type": "string", "description": "restrict search to files matching glob"},
    "limit": {"type": "integer", "description": "max matches (default 50)"}
  },
  "required": ["symbol"]
}`

	return New("find_references",
		"Find usages of a symbol via word-boundary grep across the repo.",
		schema,
		func(ctx context.Context, a findReferencesArgs) (any, error) {
			limit := a.Limit
			if limit <= 0 {
				limit = 50
			}

			pattern := fmt.Sprintf(`\b%s\b`, regexpQuote(a.Symbol))
			return ws.Grep(ctx, pattern, false, a.Repo, a.PathGlob, limit)
		})
}

func significantTerms(query string) []string {
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

func regexpQuote(s string) string {
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
