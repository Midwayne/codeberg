package resources

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// ScanDisk is called only by the dedicated, bounded disk loop, never HTTP handlers.
func ScanDisk(ctx context.Context, opts Options) (*Disk, error) {
	paths, err := diskPaths(opts)
	if err != nil {
		return nil, err
	}

	disk, err := volume(opts.Home)
	if err != nil {
		return nil, err
	}

	visited := make(map[string]bool)

	for _, root := range paths {
		if root == "" {
			continue
		}

		err := filepath.WalkDir(root, diskVisitor(ctx, disk, visited))
		if err != nil {
			return nil, err
		}
	}
	return disk, nil
}

func diskPaths(opts Options) ([]string, error) {
	paths := []string{opts.Home}
	if opts.LogDir != "" {
		paths = append(paths, opts.LogDir)
	}

	if opts.ModelPath != "" {
		paths = append(paths, opts.ModelPath)

		for _, name := range []string{"tokenizer.json", "vocab.txt", "tokenizer_config.json", "special_tokens_map.json"} {
			paths = append(paths, filepath.Join(filepath.Dir(opts.ModelPath), name))
		}
	}

	if opts.IndexPath != "" {
		dir, stem := filepath.Dir(opts.IndexPath), filepath.Base(opts.IndexPath)
		entries, err := os.ReadDir(dir)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}

		for _, entry := range entries {
			if entry.Name() == stem || strings.HasPrefix(entry.Name(), stem+".") {
				paths = append(paths, filepath.Join(dir, entry.Name()))
			}
		}
	}

	return paths, nil
}

func diskVisitor(ctx context.Context, disk *Disk, visited map[string]bool) fs.WalkDirFunc {
	return func(path string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}

		if errors.Is(walkErr, os.ErrNotExist) {
			return nil
		}

		if walkErr != nil {
			return walkErr
		}

		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}

		info, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}

		if err != nil {
			return err
		}

		bytes, key := fileAllocation(info)
		if visited[key] {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		visited[key] = true
		if info.Mode().IsRegular() {
			disk.CodebergBytes += bytes
		}
		return nil
	}
}
