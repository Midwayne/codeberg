package tools

import (
	"context"
	"fmt"

	"codeberg.org/codeberg/daemon/internal/subprocess"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

const maxSedOutput = 64 * 1024

func sedTool(ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string"},
    "path": {"type": "string", "description": "repo-relative path"},
    "script": {"type": "string", "description": "sed script (read-only commands only)"},
    "quiet": {"type": "boolean", "description": "suppress automatic printing (sed -n)"}
  },
  "required": ["path", "script"]
}`

	return New("sed",
		"Apply a read-only sed script to a file's text (piped via stdin).",
		schema,
		func(ctx context.Context, a sedArgs) (any, error) {
			if err := subprocess.ValidateSedScript(a.Script); err != nil {
				return nil, err
			}

			data, err := ws.ReadRaw(a.Repo, a.Path)
			if err != nil {
				return nil, err
			}

			return runSed(ctx, a, data)
		})
}

func runSed(ctx context.Context, a sedArgs, data []byte) (sedResult, error) {
	argv := []string{"sed"}
	if a.Quiet {
		argv = append(argv, "-n")
	}

	argv = append(argv, "-e", a.Script)

	res, err := subprocess.RunInput(ctx, argv, data)
	if err != nil {
		return sedResult{}, err
	}

	if code := res.ExitCodes[0]; code != 0 {
		return sedResult{}, fmt.Errorf("codeberg: sed: exit status %d", code)
	}

	content := res.Stdout
	truncated := res.Truncated
	if len(content) > maxSedOutput {
		content, truncated = content[:maxSedOutput], true
	}

	return sedResult{Content: content, Truncated: truncated}, nil
}
