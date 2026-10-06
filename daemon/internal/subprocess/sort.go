package subprocess

import (
	"fmt"
	"strings"
)

func validateSortArgs(args []string) error {
	flags := sortFlags()

	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			break
		}

		if strings.HasPrefix(a, "--") {
			name, _, inline := strings.Cut(a, "=")
			value, ok := flags[name]
			if !ok || (inline && !value && name != "--check") {
				return fmt.Errorf("%w: sort option %q", ErrUnsafe, a)
			}

			if value && !inline {
				i++

				if i == len(args) {
					return ErrInvalid
				}
			}
		} else if strings.HasPrefix(a, "-") && a != "-" {
			for j := 1; j < len(a); j++ {
				c := a[j]
				if strings.ContainsRune("ktS", rune(c)) {
					if j+1 == len(a) {
						i++

						if i == len(args) {
							return ErrInvalid
						}
					}

					break
				}

				if !strings.ContainsRune("bdfghinMrRsucCmVz", rune(c)) {
					return fmt.Errorf("%w: sort option %q", ErrUnsafe, a)
				}
			}
		}
	}
	return nil
}

func sortFlags() map[string]bool {
	// Exact option names prevent GNU long-option abbreviations and short-option
	// clusters from smuggling helper execution or file-writing options through.
	flags := map[string]bool{"--ignore-leading-blanks": false, "--dictionary-order": false,
		"--ignore-case": false, "--general-numeric-sort": false, "--human-numeric-sort": false,
		"--ignore-nonprinting": false, "--month-sort": false, "--numeric-sort": false,
		"--reverse": false, "--version-sort": false, "--stable": false, "--unique": false,
		"--zero-terminated": false, "--check": false, "--merge": false,
		"--random-sort": false,
		"--debug":       false, "--help": false, "--version": false,
		"--key": true, "--field-separator": true, "--buffer-size": true, "--parallel": true,
		"--sort": true, "--batch-size": true}

	return flags
}
