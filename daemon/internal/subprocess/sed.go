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

	// Parse every command, including commands inside address blocks. Splitting
	// on semicolons misses nested commands and delimiters inside expressions.
	depth := 0

	for i := 0; i < len(script); {
		c := script[i]
		if strings.ContainsRune(" \t\r\n;", rune(c)) {
			i++
			continue
		}

		if (c >= '0' && c <= '9') || strings.ContainsRune("$,+~!", rune(c)) {
			i++
			continue
		}

		if c == '/' || c == '\\' {
			next, err := sedAddress(script, i, c)
			if err != nil {
				return err
			}

			i = next
			continue
		}

		next, nextDepth, err := sedCommand(script, i+1, c, depth)
		if err != nil {
			return err
		}

		i, depth = next, nextDepth
	}

	if depth != 0 {
		return ErrUnsafeSed
	}
	return nil
}

// ValidateSedArgs ensures every sed script in a pipeline stage is read-only.
func ValidateSedArgs(args []string) error {
	scriptSeen := false
	var scripts []string

	for i := 0; i < len(args); i++ {
		a := args[i]

		switch {
		case a == "-n" || a == "--quiet" || a == "--silent":
		case a == "-e" || a == "--expression":
			if i+1 == len(args) {
				return fmt.Errorf("%w: missing sed expression", ErrInvalid)
			}
			scriptSeen = true
			scripts = append(scripts, args[i+1])
			i++
		case strings.HasPrefix(a, "-e"):
			scriptSeen = true
			scripts = append(scripts, a[2:])
		case strings.HasPrefix(a, "--expression="):
			scriptSeen = true
			scripts = append(scripts, strings.TrimPrefix(a, "--expression="))
		case strings.HasPrefix(a, "-"):
			return fmt.Errorf("%w: sed flag %q", ErrUnsafe, a)
		default:
			if !scriptSeen {
				scriptSeen = true
				scripts = append(scripts, a)
			}
		}
	}

	if !scriptSeen {
		return fmt.Errorf("%w: sed requires a script", ErrInvalid)
	}

	// Sed compiles all -e expressions together; blocks can span expressions.
	return ValidateSedScript(strings.Join(scripts, "\n"))
}

func sedDelimited(s string, i int, delim byte) (int, bool) {
	for i < len(s) {
		if s[i] == '\\' {
			i += 2
			continue
		}

		if s[i] == delim {
			return i + 1, true
		}

		i++
	}
	return i, false
}
