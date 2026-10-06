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

	root, err := w.rootFor(repo)
	if err != nil {
		return nil, err
	}

	base, err := resolve(root, path)
	if err != nil {
		return nil, err
	}

	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("codeberg: resolve root: %w", err)
	}

	return walkTree(base, realRoot, maxDepth)
}

func walkTree(base, realRoot string, maxDepth int) ([]TreeNode, error) {
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

		if d.IsDir() && depth >= maxDepth {
			return fs.SkipDir
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errStopWalk) {
		return nil, fmt.Errorf("codeberg: tree: %w", walkErr)
	}
	return nodes, nil
}
