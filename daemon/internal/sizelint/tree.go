package sizelint

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func CheckTree(root string, limits Limits) ([]Diagnostic, error) {
	var diagnostics []Diagnostic

	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		if entry.IsDir() {
			if path != root && (strings.HasPrefix(entry.Name(), ".") || entry.Name() == "vendor") {
				return filepath.SkipDir
			}
			return nil
		}

		if !strings.HasSuffix(path, ".go") {
			return nil
		}

		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		found, err := CheckFile(path, source, limits)
		if err != nil {
			return err
		}

		diagnostics = append(diagnostics, found...)
		return nil
	})

	return diagnostics, err
}
