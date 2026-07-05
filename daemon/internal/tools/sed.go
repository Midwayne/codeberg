package tools

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"

	"codeberg.org/codeberg/daemon/internal/subprocess"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

const maxSedOutput = 64 * 1024

// ErrUnsafeSed is returned when a sed script uses a disallowed command.
var ErrUnsafeSed = subprocess.ErrUnsafeSed

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

			argv := []string{}
			if a.Quiet {
				argv = append(argv, "-n")
			}
			argv = append(argv, "-e", a.Script)

			cmd := exec.CommandContext(ctx, "sed", argv...)
			cmd.Stdin = bytes.NewReader(data)

			out, err := cmd.Output()
			if err != nil {
				return nil, fmt.Errorf("codeberg: sed: %w", err)
			}

			content := string(out)
			truncated := false
			if len(content) > maxSedOutput {
				content, truncated = content[:maxSedOutput], true
			}

			return sedResult{Content: content, Truncated: truncated}, nil
		})
}
