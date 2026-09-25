package tools

import (
	"context"
	"fmt"
	"regexp"
	"strings"

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
const graphDirectionDesc = "traversal direction: in (callers), out (callees), both (default)"

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
		"Fetch a full indexed chunk (repo + id) when search_code's bounded body is absent or truncated.",
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
    "kind": {"type": "string", "description": "` + chunkKindFilterDesc + `; lexical lines must belong to an indexed chunk of this kind"},
    "min_score": {"type": "number", "description": "minimum vector similarity score (0-1); lexical matches are independent"}
  },
  "required": ["query"]
}`

	return New("hybrid_search",
		"Fuse semantic chunks with independent exact-text matches and bounded context for top hits. Lexical-only hits have id=0; use read_file for more context.",
		schema,
		func(ctx context.Context, a searchArgs) (any, error) {
			k := a.K
			if k <= 0 {
				k = 8
			}

			if k > 64 {
				k = 64
			}
			candidates, searchErr := idx.Search(ctx, indexctl.SearchOptions{
				Query:    a.Query,
				K:        min(k*2, 64),
				Repo:     a.Repo,
				PathGlob: a.PathGlob,
				Kind:     a.Kind,
				MinScore: a.MinScore,
			})
			if searchErr != nil {
				ie, ok := indexctl.AsIndexerError(searchErr)
				if !ok || ie.Code != "NOT_IMPLEMENTED" {
					return nil, searchErr
				}
			}
			matches, err := hybridLexicalMatches(ctx, ws, idx, a, min(k*4, 64))
			if err != nil {
				return nil, err
			}
			if searchErr != nil && len(matches) == 0 {
				return nil, searchErr
			}
			hits := search.Fuse(candidates, matches, k, a.Query)
			enrichHybridContext(ctx, idx, ws, hits)
			return hits, nil
		})
}

func enrichHybridContext(ctx context.Context, idx indexctl.Indexer, ws *workspace.Workspace, hits []search.HybridHit) {
	const maxPerHit = 2500
	remaining := 6000
	for i := 0; i < min(3, len(hits)) && remaining > 0; i++ {
		hit := &hits[i]
		var body string
		var startLine, matchLine uint32
		var alreadyTruncated bool
		if hit.Hit.ID > 0 {
			detail, err := idx.GetChunk(ctx, hit.Hit.Repo, hit.Hit.ID)
			if err != nil || detail.Body == "" {
				continue
			}
			body, startLine, matchLine = detail.Body, detail.StartLine, detail.StartLine
			alreadyTruncated = detail.Truncated
		} else {
			line := hit.Hit.StartLine
			start := uint32(1)
			if line > 4 {
				start = line - 4
			}
			file, err := ws.ReadFile(hit.Hit.Repo, hit.Hit.Path, start, line+4)
			if err != nil {
				continue
			}
			body, startLine, matchLine = file.Content, file.StartLine, line
		}
		maxChars := min(maxPerHit, remaining)
		text := []rune(body)
		from := 0
		if len(text) > maxChars {
			// Keep the matching line in view even when surrounding lines are huge.
			lines := strings.SplitAfter(body, "\n")
			for j := uint32(0); j < matchLine-startLine && int(j) < len(lines); j++ {
				from += len([]rune(lines[j]))
			}
			from = max(0, min(from-maxChars/3, len(text)-maxChars))
		}
		to := min(from+maxChars, len(text))
		hit.Context = string(text[from:to])
		hit.ContextStartLine = startLine + uint32(strings.Count(string(text[:from]), "\n"))
		hit.ContextEndLine = hit.ContextStartLine + uint32(strings.Count(hit.Context, "\n"))
		hit.ContextTruncated = alreadyTruncated || from > 0 || to < len(text)
		remaining -= to - from
	}
}

func hybridLexicalMatches(ctx context.Context, ws *workspace.Workspace, idx indexctl.Indexer, a searchArgs, limit int) ([]workspace.GrepMatch, error) {
	pattern := search.LexicalPattern(a.Query)
	if pattern == "" {
		return nil, nil
	}
	repos := []string{a.Repo}
	if a.Repo == "" {
		repos = nil
		for _, repo := range ws.Repos() {
			repos = append(repos, repo.Key)
		}
	}
	var matches []workspace.GrepMatch
	perRepo := limit
	if len(repos) > 1 {
		perRepo = max(1, limit/len(repos))
	}
	for _, repo := range repos {
		found, err := ws.GrepForRetrieval(ctx, pattern, repo, a.PathGlob, min(perRepo, limit-len(matches)))
		if err != nil {
			return nil, err
		}
		matches = append(matches, found...)
		if len(matches) >= limit {
			break
		}
	}
	if a.Kind == "" {
		return search.PrioritizeLexical(matches, a.Query), nil
	}
	// A lexical line has no chunk kind. Resolve it against indexed spans only
	// when the caller requested a kind; omit untyped/unindexed lines then.
	filtered := make([]workspace.GrepMatch, 0, len(matches))
	outlines := make(map[string][]indexctl.SearchResult)
	kinds := make(map[string]string)
	for _, match := range matches {
		key := match.Repo + "\x00" + match.Path
		outline, ok := outlines[key]
		if !ok {
			outline, _ = idx.FileOutline(ctx, match.Repo, match.Path)
			outlines[key] = outline
		}
		for _, chunk := range outline {
			if match.Line < chunk.StartLine || match.Line > chunk.EndLine {
				continue
			}
			chunkKey := fmt.Sprintf("%s\x00%d", match.Repo, chunk.ID)
			kind, ok := kinds[chunkKey]
			if !ok {
				detail, err := idx.GetChunk(ctx, match.Repo, chunk.ID)
				if err == nil {
					kind = detail.Kind
				}
				kinds[chunkKey] = kind
			}
			if strings.EqualFold(kind, a.Kind) {
				filtered = append(filtered, match)
				break
			}
		}
	}
	return search.PrioritizeLexical(filtered, a.Query), nil
}

func searchGraphTool(idx indexctl.Indexer) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {"type": "string", "description": "exact node name to find"},
    "repo": {"type": "string", "description": "restrict to one repo key"},
    "kind": {"type": "string", "description": "` + graphNodeKindDesc + `"},
    "path_prefix": {"type": "string", "description": "component-aware path prefix (foo matches foo/bar, not foobar)"},
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
	Source  string                `json:"source"` // "graph" or "grep"
	Graph   []indexctl.GraphEdge  `json:"graph,omitempty"`
	Matches []workspace.GrepMatch `json:"matches,omitempty"`
}

func findReferencesTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "symbol": {"type": "string", "description": "symbol name to find references for"},
    "repo": {"type": "string", "description": "repo key"},
    "path_prefix": {"type": "string", "description": "restrict graph lookup to nodes under this path prefix"},
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
				Name:       a.Symbol,
				Repo:       a.Repo,
				PathPrefix: a.PathPrefix,
				Limit:      limit,
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
