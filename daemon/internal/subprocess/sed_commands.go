package subprocess

import (
	"fmt"
	"strings"
)

func sedAddress(script string, i int, c byte) (int, error) {
	delim := c
	i++

	if c == '\\' {
		if i == len(script) {
			return i, ErrUnsafeSed
		}

		delim = script[i]
		i++
	}

	var ok bool
	i, ok = sedDelimited(script, i, delim)
	if !ok {
		return i, ErrUnsafeSed
	}

	return i, nil
}

func sedCommand(script string, i int, c byte, depth int) (int, int, error) {
	if !allowedSedCommands[c] {
		return i, depth, fmt.Errorf("%w: %q", ErrUnsafeSed, string(c))
	}

	switch c {
	case '{':
		depth++
	case '}':
		depth--
		if depth < 0 {
			return i, depth, ErrUnsafeSed
		}
	case '#':
		for i < len(script) && script[i] != '\n' {
			i++
		}
	case ':', 'b', 't', 'T':
		for i < len(script) && !strings.ContainsRune(";\n}", rune(script[i])) {
			i++
		}
	case 's', 'y':
		var err error
		i, err = sedSubstitution(script, i, c)
		if err != nil {
			return i, depth, err
		}
	}
	return i, depth, nil
}

func sedSubstitution(script string, i int, c byte) (int, error) {
	if i == len(script) {
		return i, ErrUnsafeSed
	}

	delim := script[i]
	if delim == '\\' || delim == '\n' {
		return i, ErrUnsafeSed
	}

	i++

	for n := 0; n < 2; n++ {
		var ok bool
		i, ok = sedDelimited(script, i, delim)
		if !ok {
			return i, ErrUnsafeSed
		}
	}

	for i < len(script) && !strings.ContainsRune(";\n}", rune(script[i])) {
		flag := script[i]
		if flag != ' ' && flag != '\t' && (c != 's' || (!strings.ContainsRune("gpIiMm", rune(flag)) && (flag < '0' || flag > '9'))) {
			return i, fmt.Errorf("%w: substitution flag %q", ErrUnsafeSed, flag)
		}

		i++
	}
	return i, nil
}
