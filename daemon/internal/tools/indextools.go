package tools

import (
	"context"
	"fmt"
	"regexp"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/search"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

const chunkKindFilterDesc = "chunk kind: function, method, class, struct, interface, window, section, key"

func registerIndexTools(r *Registry, idx indexctl.Indexer, ws *workspace.Workspace) {
	r.Register(searchTool(idx))
	r.Register(getChunkTool(idx))
	r.Register(findSymbolTool(idx))
	r.Register(fileOutlineTool(idx))
	r.Register(hybridSearchTool(idx, ws))
	r.Register(searchGraphTool(idx))
	r.Register(tracePathTool(idx))
	r.Register(detectChangesTool(idx, ws))
	r.Register(getArchitectureTool(idx))
	r.Register(findReferencesTool(idx, ws))
}

const graphNodeKindDesc = "graph node kind: file, function, method, class, struct, interface, module, symbol"
const graphEdgeKindDesc = "edge kind: calls, imports, inherits, contains, defines, references, all"
const graphDirectionDesc = "traversal direction: in (callers, default), out (callees), both"

func searchTool(idx indexctl.Indexer) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {"type": "string", "description": "natural-language search query"},
    "k": {"type": "integer", "description": "max results (default 10)"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "path_glob": {"type": "string", "description": "fnmatch glob on chunk paths, e.g. daemon/*"},
    "kind": {"type": "string", "description": "` + chunkKindFilterDesc + `"},
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

func getChunkTool(idx indexctl.Indexer) Tool {
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

func findSymbolTool(idx indexctl.Indexer) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {"type": "string", "description": "symbol name to find"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "kind": {"type": "string", "description": "` + chunkKindFilterDesc + `"},
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

func fileOutlineTool(idx indexctl.Indexer) Tool {
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

func hybridSearchTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "query": {"type": "string", "description": "natural-language search query"},
    "k": {"type": "integer", "description": "max results (default 8)"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "path_glob": {"type": "string", "description": "fnmatch glob on chunk paths"},
    "kind": {"type": "string", "description": "` + chunkKindFilterDesc + `"},
    "min_score": {"type": "number", "description": "minimum similarity score (0-1)"}
  },
  "required": ["query"]
}`

	return New("hybrid_search",
		"Vector search candidates reranked by grep verification of query terms in hit chunks.",
		schema,
		func(ctx context.Context, a searchArgs) (any, error) {
			k := a.K
			if k <= 0 {
				k = 8
			}

			candidates, err := idx.Search(ctx, indexctl.SearchOptions{
				Query:    a.Query,
				K:        k * 2,
				Repo:     a.Repo,
				PathGlob: a.PathGlob,
				Kind:     a.Kind,
				MinScore: a.MinScore,
			})
			if err != nil {
				return nil, err
			}

			return search.Hybrid(ctx, candidates, a.Query, func(ctx context.Context, repo, path string) ([]byte, error) {
				return ws.ReadRaw(repo, path)
			}, k)
		})
}

func searchGraphTool(idx indexctl.Indexer) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {"type": "string", "description": "exact node name to find"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "kind": {"type": "string", "description": "` + graphNodeKindDesc + `"},
    "path_prefix": {"type": "string", "description": "restrict to nodes whose path starts with this prefix"},
    "limit": {"type": "integer", "description": "max results (default 20)"}
  },
  "required": ["name"]
}`

	return New("search_graph",
		"Structural symbol search over the knowledge graph (exact name). Prefer for known symbols when you need graph ids/kinds; use find_symbol for chunk-table lookup.",
		schema,
		func(ctx context.Context, a searchGraphArgs) (any, error) {
			return idx.SearchGraph(ctx, indexctl.GraphSearchOptions{
				Name:       a.Name,
				Repo:       a.Repo,
				Kind:       a.Kind,
				PathPrefix: a.PathPrefix,
				Limit:      a.Limit,
			})
		})
}

func tracePathTool(idx indexctl.Indexer) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {"type": "string", "description": "symbol name to start from"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "direction": {"type": "string", "description": "` + graphDirectionDesc + `"},
    "edge_kind": {"type": "string", "description": "` + graphEdgeKindDesc + `"},
    "max_depth": {"type": "integer", "description": "BFS depth limit (default 2)"},
    "limit": {"type": "integer", "description": "max hops (default 64)"}
  },
  "required": ["name"]
}`

	return New("trace_path",
		"BFS over the knowledge graph from a symbol (callers/callees/imports). Edges include resolution and confidence — treat textual links as hints, not go-to-definition.",
		schema,
		func(ctx context.Context, a tracePathArgs) (any, error) {
			return idx.TracePath(ctx, indexctl.TracePathOptions{
				Name:      a.Name,
				Repo:      a.Repo,
				Direction: a.Direction,
				EdgeKind:  a.EdgeKind,
				MaxDepth:  a.MaxDepth,
				Limit:     a.Limit,
			})
		})
}

// findReferencesResult is graph-first when possible, with grep fallback.
type findReferencesResult struct {
	Source  string               `json:"source"` // "graph" or "grep"
	Graph   []indexctl.GraphEdge `json:"graph,omitempty"`
	Matches []workspace.GrepMatch `json:"matches,omitempty"`
}

func findReferencesTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "symbol": {"type": "string", "description": "symbol name to find references for"},
    "repo": {"type": "string", "description": "repo key"},
    "path_glob": {"type": "string", "description": "restrict grep fallback to files matching glob"},
    "limit": {"type": "integer", "description": "max matches (default 50)"}
  },
  "required": ["symbol"]
}`

	return New("find_references",
		"Find usages of a symbol: prefers knowledge-graph edges (with resolution/confidence), falls back to word-boundary grep.",
		schema,
		func(ctx context.Context, a findReferencesArgs) (any, error) {
			limit := a.Limit
			if limit <= 0 {
				limit = 50
			}

			edges, err := idx.GraphRefs(ctx, indexctl.GraphRefsOptions{
				Name:  a.Symbol,
				Repo:  a.Repo,
				Limit: limit,
			})
			if err == nil && len(edges) > 0 {
				return findReferencesResult{Source: "graph", Graph: edges}, nil
			}

			pattern := fmt.Sprintf(`\b%s\b`, regexp.QuoteMeta(a.Symbol))
			matches, gerr := ws.Grep(ctx, pattern, false, a.Repo, a.PathGlob, limit)
			if gerr != nil {
				if err != nil {
					return nil, err
				}
				return nil, gerr
			}
			return findReferencesResult{Source: "grep", Matches: matches}, nil
		})
}
