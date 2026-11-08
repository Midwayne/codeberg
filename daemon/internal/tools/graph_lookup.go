package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

const graphNodeKindDesc = "node category: file, function, method, class, struct, interface, module; symbol selects any code-symbol category"

const graphEdgeKindDesc = "relationship: calls (default), imports (file dependencies), inherits (child to base), contains (type to members), defines (file to symbols), references (non-call uses in Go/TS/JS), or all"

const graphDirectionDesc = "in follows incoming edges (callers/importers/subtypes); out follows outgoing edges (callees/imported files/supertypes); both follows either direction (default)"

func searchGraphTool(idx indexctl.Indexer) Tool {
	schema := `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "name": {"type": "string", "description": "exact, case-sensitive symbol name or file basename; use grep for unknown names"},
    "repo": {"type": "string", "description": "repository key from repos; omitted searches all roots configured together"},
    "kind": {"type": "string", "description": "` + graphNodeKindDesc + `"},
    "path_prefix": {"type": "string", "description": "component-aware path prefix (foo matches foo/bar, not foobar)"},
    "limit": {"type": "integer", "description": "max results (default 20)"}
  },
  "required": ["name"]
}`

	return New("search_graph",
		"Locate a known symbol in the source-code graph before following its relationships. "+
			"Returns repo, id, kind, path, and line range so you can choose the intended definition. "+
			"Search is exact and case-sensitive; use grep to discover names, and find_symbol/get_chunk for source bodies. "+
			"Omitting repo searches all roots configured together. Works without embeddings after parsing; an empty result does not prove the code is absent.",
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
    "name": {"type": "string", "description": "exact symbol or file-node name to start from; locate it with search_graph first"},
    "repo": {"type": "string", "description": "starting definition's repo key; required when the name is ambiguous across roots; traversal may cross import-backed links to other configured roots"},
    "path_prefix": {"type": "string", "description": "starting definition's relative file path or directory prefix; does not filter later hops"},
    "direction": {"type": "string", "description": "` + graphDirectionDesc + `"},
    "edge_kind": {"type": "string", "description": "` + graphEdgeKindDesc + `"},
    "max_depth": {"type": "integer", "description": "1 for direct relationships, 2 for one additional step (default 2)"},
    "limit": {"type": "integer", "description": "maximum returned relationship hops (default 64); results are bounded"}
  },
  "required": ["name"]
}`

	return New("trace_path",
		"Follow calls, imports, inheritance, or membership from a known source-code node. "+
			"For calls, direction=in finds callers and out finds callees; max_depth=1 returns direct relationships. "+
			"Use search_graph to choose repo/path_prefix before tracing same-name definitions. "+
			"repo scopes the start, so later hops may belong to other configured roots; preserve src_repo/dst_repo with IDs and paths. "+
			"Results are partial syntactic relationships. Confidence is heuristic; same-name methods may be ambiguous and dynamic calls or aliases may be missing. "+
			"Verify source with read_file; an empty result does not prove there is no dependency. Works without embeddings.",
		schema,
		func(ctx context.Context, a tracePathArgs) (any, error) {
			return idx.TracePath(ctx, indexctl.TracePathOptions{
				Name:       a.Name,
				Repo:       a.Repo,
				PathPrefix: a.PathPrefix,
				Direction:  a.Direction,
				EdgeKind:   a.EdgeKind,
				MaxDepth:   a.MaxDepth,
				Limit:      a.Limit,
			})
		})
}

type searchGraphArgs struct {
	Name       string `json:"name"`
	Repo       string `json:"repo"`
	Kind       string `json:"kind"`
	PathPrefix string `json:"path_prefix"`
	Limit      int    `json:"limit"`
}

type tracePathArgs struct {
	PathPrefix string `json:"path_prefix"`
	Name       string `json:"name"`
	Repo       string `json:"repo"`
	Direction  string `json:"direction"`
	EdgeKind   string `json:"edge_kind"`
	MaxDepth   int    `json:"max_depth"`
	Limit      int    `json:"limit"`
}
