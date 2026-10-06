package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func detectChangesTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string", "description": "repo key"},
    "base": {"type": "string", "description": "git base ref (default HEAD~1)"},
    "head": {"type": "string", "description": "git head ref (default HEAD)"},
    "depth": {"type": "integer", "description": "graph hop depth for blast radius (default 2)"},
    "limit": {"type": "integer", "description": "max symbols to report (default 40)"}
  }
}`

	return New("detect_changes",
		"Map a git diff to symbols overlapping changed hunks and 1–2 hop graph neighbors (blast radius). Risk: direct = symbols intersecting the diff; transitive = callers/callees via trace_path. On range failure, falls back to working-tree vs HEAD and sets fallback.",
		schema,
		func(ctx context.Context, a detectChangesArgs) (any, error) {
			return detectChanges(ctx, idx, ws, a)
		})
}
