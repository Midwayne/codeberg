package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"codeberg.org/codeberg/daemon/internal/sizelint"
)

func main() {
	root := flag.String("root", ".", "daemon source directory")
	flag.Parse()

	if err := run(*root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(root string) error {
	limits, err := sizelint.LoadLimits(filepath.Join(root, ".lint.json"))
	if err != nil {
		return err
	}

	diagnostics, err := sizelint.CheckTree(root, limits)
	if err != nil {
		return err
	}

	for _, diagnostic := range diagnostics {
		fmt.Fprintln(os.Stderr, diagnostic)
	}

	if len(diagnostics) > 0 {
		return fmt.Errorf("daemon lint failed with %d violation(s)", len(diagnostics))
	}

	return nil
}
