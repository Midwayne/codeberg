package storage

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// IndexSet is one indexed root's cached files in one index directory.
type IndexSet struct {
	Name  string   `json:"name"`
	Files []string `json:"files"`
}

// Report is the machine-readable layout printed by `codeberg-d storage`.
type Report struct {
	Home      string     `json:"home"`
	Owned     []string   `json:"owned"`
	IndexSets []IndexSet `json:"indexSets"`
}

func (l Layout) Report() (Report, error) {
	sets, err := l.IndexSets()
	if err != nil {
		return Report{}, err
	}

	return Report{Home: l.Home, Owned: l.Owned(), IndexSets: sets}, nil
}

// IndexSets groups every cached index file under Home by directory and root.
func (l Layout) IndexSets() ([]IndexSet, error) {
	roots, err := filepath.Glob(filepath.Join(l.Projects(), "*", "index"))
	if err != nil {
		return nil, err
	}

	roots = append([]string{l.LegacyIndexDir()}, roots...)
	byName := map[string][]string{}

	for _, root := range roots {
		if err := filepath.WalkDir(root, l.collect(byName)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}

	sets := make([]IndexSet, 0, len(byName))

	for name, files := range byName {
		sets = append(sets, IndexSet{Name: name, Files: files})
	}

	sort.Slice(sets, func(i, j int) bool { return sets[i].Name < sets[j].Name })
	return sets, nil
}

func (l Layout) collect(byName map[string][]string) fs.WalkDirFunc {
	return func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if !entry.Type().IsRegular() || !strings.HasPrefix(entry.Name(), IndexFile) {
			return nil
		}

		dir, err := filepath.Rel(l.Home, filepath.Dir(path))
		if err != nil {
			return err
		}

		name := filepath.ToSlash(dir) + ":" + familyTag(IndexFile, entry.Name())
		byName[name] = append(byName[name], path)

		return nil
	}
}
