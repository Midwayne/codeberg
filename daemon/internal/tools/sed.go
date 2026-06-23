package tools

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

const maxSedOutput = 64 * 1024

var ErrUnsafeSed = errors.New("codeberg: sed script uses a disallowed command")

var allowedSedCommands = map[byte]bool{
	's': true, 'y': true, 'p': true, 'P': true, 'd': true, 'D': true,
	'n': true, 'N': true, 'g': true, 'G': true, 'h': true, 'H': true,
	'x': true, 'l': true, '=': true, 'q': true, 'Q': true,
	'b': true, 't': true, 'T': true, ':': true, '{': true, '}': true, '#': true,
}

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
	type args struct {
		Repo   string `json:"repo"`
		Path   string `json:"path"`
		Script string `json:"script"`
		Quiet  bool   `json:"quiet"`
	}
	return New("sed",
		"Apply a read-only sed script to a file's text (piped via stdin).",
		schema,
		func(ctx context.Context, a args) (any, error) {
			if err := validateSedScript(a.Script); err != nil {
				return nil, err
			}
			data, err := ws.ReadRaw(a.Repo, a.Path)
			if err != nil {
				return nil, err
			}
			sedArgs := []string{}
			if a.Quiet {
				sedArgs = append(sedArgs, "-n")
			}
			sedArgs = append(sedArgs, "-e", a.Script)
			cmd := exec.CommandContext(ctx, "sed", sedArgs...)
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
			return map[string]any{"content": content, "truncated": truncated}, nil
		})
}

func validateSedScript(script string) error {
	if strings.TrimSpace(script) == "" {
		return fmt.Errorf("%w: empty script", ErrInvalidArgs)
	}
	for _, seg := range strings.FieldsFunc(script, func(r rune) bool { return r == ';' || r == '\n' }) {
		cmd := sedCommandLetter(seg)
		if cmd == 0 {
			continue
		}
		if !allowedSedCommands[cmd] {
			return fmt.Errorf("%w: %q", ErrUnsafeSed, string(cmd))
		}
		if (cmd == 's' || cmd == 'y') && sedHasUnsafeFlag(seg, cmd) {
			return fmt.Errorf("%w: s/y write or exec flag", ErrUnsafeSed)
		}
	}
	return nil
}

func sedCommandLetter(seg string) byte {
	s := strings.TrimSpace(seg)
	i := 0
	for i < len(s) {
		switch c := s[i]; {
		case (c >= '0' && c <= '9') || c == '$' || c == ',' || c == '~' ||
			c == ' ' || c == '\t' || c == '+' || c == '!':
			i++
		case c == '/':
			i++
			for i < len(s) && s[i] != '/' {
				if s[i] == '\\' {
					i++
				}
				i++
			}
			if i < len(s) {
				i++
			}
		default:
			return s[i]
		}
	}
	return 0
}

func sedHasUnsafeFlag(seg string, cmd byte) bool {
	s := strings.TrimSpace(seg)
	idx := strings.IndexByte(s, cmd)
	if idx < 0 || idx+1 >= len(s) {
		return false
	}
	delimPos := idx + 1
	delim := s[delimPos]
	count, j := 0, delimPos+1
	for j < len(s) && count < 2 {
		if s[j] == '\\' {
			j += 2
			continue
		}
		if s[j] == delim {
			count++
		}
		j++
	}
	return strings.ContainsAny(s[j:], "wWe")
}
