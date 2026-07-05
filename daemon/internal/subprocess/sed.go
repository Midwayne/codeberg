package subprocess

import (
	"errors"
	"fmt"
	"strings"
)

var allowedSedCommands = map[byte]bool{
	's': true, 'y': true, 'p': true, 'P': true, 'd': true, 'D': true,
	'n': true, 'N': true, 'g': true, 'G': true, 'h': true, 'H': true,
	'x': true, 'l': true, '=': true, 'q': true, 'Q': true,
	'b': true, 't': true, 'T': true, ':': true, '{': true, '}': true, '#': true,
}

// ErrUnsafeSed is returned when a sed script uses a disallowed command.
var ErrUnsafeSed = errors.New("codeberg: sed script uses a disallowed command")

// ValidateSedScript checks that a sed script uses only read-only commands.
func ValidateSedScript(script string) error {
	if strings.TrimSpace(script) == "" {
		return fmt.Errorf("%w: empty script", ErrInvalid)
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

// ValidateSedArgs ensures every sed script in a pipeline stage is read-only.
func ValidateSedArgs(args []string) error {
	scriptSeen := false

	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-n" || a == "--quiet" || a == "--silent":
		case a == "-e" || a == "--expression":
			scriptSeen = true
			if i+1 < len(args) {
				if err := ValidateSedScript(args[i+1]); err != nil {
					return err
				}
				i++
			}
		case strings.HasPrefix(a, "-e"):
			scriptSeen = true
			if err := ValidateSedScript(a[2:]); err != nil {
				return err
			}
		case strings.HasPrefix(a, "--expression="):
			scriptSeen = true
			if err := ValidateSedScript(strings.TrimPrefix(a, "--expression=")); err != nil {
				return err
			}
		case strings.HasPrefix(a, "-"):
			return fmt.Errorf("%w: sed flag %q", ErrUnsafe, a)
		default:
			if !scriptSeen {
				scriptSeen = true
				if err := ValidateSedScript(a); err != nil {
					return err
				}
			}
		}
	}

	if !scriptSeen {
		return fmt.Errorf("%w: sed requires a script", ErrInvalid)
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
