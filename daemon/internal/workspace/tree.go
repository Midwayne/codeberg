package workspace

import (
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"
)

func (w *Workspace) Tree(repo, path string, maxDepth int) ([]TreeNode, error) {
	if maxDepth <= 0 {
		maxDepth = defaultTreeDepth
	}

	key, err := w.resolveKey(repo)
	if err != nil {
		return nil, err
	}

	root := w.byKey[key]

	base, err := resolve(root, path)
	if err != nil {
		return nil, err
	}

	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("codeberg: resolve root: %w", err)
	}

	return walkTree(base, realRoot, maxDepth, w.nested[key])
}

// walkTree lists a nested root as a directory without descending into it;
// its contents belong to that root.
func walkTree(base, realRoot string, maxDepth int, nested []string) ([]TreeNode, error) {
	var nodes []TreeNode
	walkErr := filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if p == base {
			return nil
		}

		relBase, _ := filepath.Rel(base, p)
		depth := strings.Count(relBase, string(filepath.Separator)) + 1
		if d.IsDir() && SkipDir(d.Name()) {
			return fs.SkipDir
		}

		relRoot, _ := filepath.Rel(realRoot, p)
		nodes = append(nodes, TreeNode{Path: filepath.ToSlash(relRoot), IsDir: d.IsDir(), Depth: depth})
		if len(nodes) >= maxTreeEntries {
			return errStopWalk
		}

		if d.IsDir() && (depth >= maxDepth || nestedPath(nested, relRoot)) {
			return fs.SkipDir
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errStopWalk) {
		return nil, fmt.Errorf("codeberg: tree: %w", walkErr)
	}
	return nodes, nil
}
