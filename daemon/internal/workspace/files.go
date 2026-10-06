package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
)

func (w *Workspace) Glob(_ context.Context, pattern, repo string, limit int) ([]FileRef, error) {
	if pattern == "" {
		return nil, fmt.Errorf("codeberg: glob: empty pattern")
	}

	if limit <= 0 || limit > w.maxFiles {
		limit = w.maxFiles
	}

	repoKey, err := w.resolveKey(repo)
	if err != nil {
		return nil, err
	}

	dir := w.byKey[repoKey]
	fsys := os.DirFS(dir)
	ms, globErr := doublestar.Glob(fsys, pattern, doublestar.WithFilesOnly())
	if globErr != nil {
		return nil, fmt.Errorf("codeberg: glob: %w", globErr)
	}

	sort.Strings(ms)
	var files []FileRef

	for _, m := range ms {
		files = append(files, FileRef{Repo: repoKey, Path: filepath.ToSlash(m)})
		if len(files) >= limit {
			break
		}
	}
	return files, nil
}

func (w *Workspace) ReadFile(repo, path string, startLine, endLine uint32) (FileContent, error) {
	root, err := w.rootFor(repo)
	if err != nil {
		return FileContent{}, err
	}

	full, err := resolve(root, path)
	if err != nil {
		return FileContent{}, err
	}

	data, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			return FileContent{}, fmt.Errorf("%w: %s", ErrNotFound, path)
		}
		return FileContent{}, fmt.Errorf("codeberg: read file: %w", err)
	}

	lines := strings.Split(string(data), "\n")
	total := uint32(len(lines))

	start := startLine
	if start == 0 {
		start = 1
	}

	end := endLine
	if end == 0 || end > total {
		end = total
	}

	if start > total {
		start = total
	}

	if end < start {
		end = start
	}

	content := strings.Join(lines[start-1:end], "\n")
	if len(content) > w.maxBytes {
		content = content[:w.maxBytes]
	}

	return FileContent{Content: content, StartLine: start, EndLine: end, TotalLines: total}, nil
}

func (w *Workspace) ListDir(repo, path string) ([]DirEntry, error) {
	root, err := w.rootFor(repo)
	if err != nil {
		return nil, err
	}

	full, err := resolve(root, path)
	if err != nil {
		return nil, err
	}

	infos, err := os.ReadDir(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, path)
		}
		return nil, fmt.Errorf("codeberg: list dir: %w", err)
	}

	entries := make([]DirEntry, 0, len(infos))

	for _, e := range infos {
		entries = append(entries, DirEntry{Name: e.Name(), IsDir: e.IsDir()})
	}
	return entries, nil
}

func (w *Workspace) ReadRaw(repo, path string) ([]byte, error) {
	root, err := w.rootFor(repo)
	if err != nil {
		return nil, err
	}

	full, err := resolve(root, path)
	if err != nil {
		return nil, err
	}

	info, err := os.Stat(full)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, path)
	}

	if info.IsDir() {
		return nil, fmt.Errorf("%w: %s is a directory", ErrNotFound, path)
	}

	if info.Size() > maxRawBytes {
		return nil, fmt.Errorf("codeberg: file too large: %s (%d bytes)", path, info.Size())
	}
	return os.ReadFile(full)
}
