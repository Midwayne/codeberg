package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

const graphNodeKindDesc = "graph node kind: file, function, method, class, struct, interface, module, symbol"

const graphEdgeKindDesc = "edge kind: calls, imports, inherits, contains, defines, references, all"

const graphDirectionDesc = "traversal direction: in (callers), out (callees), both (default)"

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
