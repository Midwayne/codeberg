package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/subprocess"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func pipeTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "command": {"type": "string", "description": "read-only pipeline, e.g. \"rg -l TODO --glob '*.go' | head -20\". Stages joined by | ; no shell is run, so > < ; & $() and backticks are rejected."},
    "repo": {"type": "string", "description": "repo key (default root)"}
  },
  "required": ["command"]
}`

	return New("pipe",
		"Run a read-only pipeline over the repo in ONE call, chaining rg/grep with text "+
			"filters (head, tail, wc, sort, uniq, cut, tr, nl, cat, paste, sed) using '|'. "+
			"The first stage searches repo files; later stages filter stdin. No shell is "+
			"invoked: redirection, command substitution, ';' and '&' are rejected, and paths "+
			"cannot escape the repo. Prefer this over several grep/read_file calls.",
		schema,
		func(ctx context.Context, a pipeArgs) (any, error) {
			root, err := ws.RepoRoot(a.Repo)
			if err != nil {
				return nil, err
			}

			res, err := subprocess.RunPipeline(ctx, root, a.Command)
			if err != nil {
				return nil, err
			}

			return toPipeResult(res), nil
		})
}

func toPipeResult(r subprocess.Result) pipeResult {
	return pipeResult{
		Command:   r.Command,
		Stdout:    r.Stdout,
		Truncated: r.Truncated,
		ExitCodes: r.ExitCodes,
	}
}

// ErrUnsafePipe is returned when a pipeline uses a disallowed command or operator.
var ErrUnsafePipe = subprocess.ErrUnsafe
