package subprocess

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

var allowedCommands = map[string]bool{
	"rg": true, "grep": true, "head": true, "tail": true, "wc": true,
	"sort": true, "uniq": true, "cut": true, "tr": true, "nl": true,
	"cat": true, "paste": true, "sed": true,
}

var deniedFlags = map[string]map[string]bool{
	"rg": {
		"--pre": true, "--pre-glob": true, "--hostname-bin": true,
		"--search-zip": true, "-z": true,
	},
	"sort": {
		"-o": true, "--output": true, "--files0-from": true,
	},
	"sed": {
		"-i": true, "--in-place": true, "-f": true, "--file": true,
	},
}

// ValidateStage checks one pipeline stage against the read-only allowlist.
func ValidateStage(argv []string) error {
	return validateStage(argv)
}

func validateStage(argv []string) error {
	if len(argv) == 0 {
		return fmt.Errorf("%w: empty stage", ErrUnsafe)
	}

	cmd := argv[0]
	if !allowedCommands[cmd] {
		return fmt.Errorf("%w: command %q", ErrUnsafe, cmd)
	}

	denied := deniedFlags[cmd]

	for _, arg := range argv[1:] {
		flagCore := arg
		if strings.HasPrefix(arg, "-") {
			if before, _, found := strings.Cut(arg, "="); found {
				flagCore = before
			}
		}

		if denied[flagCore] {
			return fmt.Errorf("%w: flag %q for %q", ErrUnsafe, flagCore, cmd)
		}

		if err := checkPathToken(arg); err != nil {
			return err
		}
	}

	if cmd == "sed" {
		return ValidateSedArgs(argv[1:])
	}

	if cmd == "sort" {
		return validateSortArgs(argv[1:])
	}

	return nil
}

func checkPathToken(arg string) error {
	candidates := []string{arg}
	if _, after, found := strings.Cut(arg, "="); found {
		candidates = append(candidates, after)
	}

	for _, c := range candidates {
		if c == "" {
			continue
		}

		if filepath.IsAbs(c) {
			return fmt.Errorf("%w: absolute path %q", workspace.ErrEscape, c)
		}

		if hasDotDot(c) {
			return fmt.Errorf("%w: %q", workspace.ErrEscape, c)
		}
	}

	return nil
}

func hasDotDot(p string) bool {
	return slices.Contains(strings.Split(strings.ReplaceAll(p, "\\", "/"), "/"), "..")
}
