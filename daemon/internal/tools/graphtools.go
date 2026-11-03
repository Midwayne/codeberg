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
    "repo": {"type": "string", "description": "repository whose Git diff to inspect; required when the workspace has no default repo; related graph symbols can be in other configured roots"},
    "base": {"type": "string", "description": "git base ref (default HEAD~1)"},
    "head": {"type": "string", "description": "git head ref (default HEAD)"},
    "depth": {"type": "integer", "description": "graph hop depth for blast radius (default 2)"},
    "limit": {"type": "integer", "description": "max symbols to report (default 40)"}
  }
}`

	return New("detect_changes",
		"Review likely code impact of a Git diff in one repository. Direct symbols overlap changed lines; transitive symbols are nearby callers/callees and may be in other configured roots. "+
			"Risk labels describe graph proximity, not confirmed breakage or complete impact. Defaults to HEAD~1...HEAD and two relationship steps. "+
			"If the Git range fails, compares the working tree with HEAD and reports fallback/diff_spec. Verify source and relevant tests. Requires Git; embeddings are not required.",
		schema,
		func(ctx context.Context, a detectChangesArgs) (any, error) {
			return detectChanges(ctx, idx, ws, a)
		})
}
