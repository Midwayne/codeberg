package projects

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

// repoMarkers make a folder its own root: version control, or the manifest
// that cross-repository import linking reads.
var repoMarkers = []string{
	".git", "go.mod", "package.json", "Cargo.toml",
	"pyproject.toml", "setup.py", "setup.cfg",
	"pom.xml", "build.gradle", "build.gradle.kts",
	"Gemfile", "CMakeLists.txt", "meson.build",
}

const (
	discoverDepth = 3
	maxDiscovered = 200
)

// Discovered is a folder inside a project directory indexed as its own root.
type Discovered struct {
	Key    string `json:"key"`
	Root   string `json:"root"`
	Path   string `json:"path"`
	Marker string `json:"marker"`
}

// repoMarker names the first marker in dir, or "" when it has none.
func repoMarker(dir string) string {
	for _, name := range repoMarkers {
		if _, err := os.Lstat(filepath.Join(dir, name)); err == nil {
			return name
		}
	}

	if gemspecs, _ := filepath.Glob(filepath.Join(dir, "*.gemspec")); len(gemspecs) > 0 {
		return filepath.Base(gemspecs[0])
	}

	return ""
}

// discoverRepositories finds repositories up to discoverDepth levels below dir,
// without looking inside one once found. A directory that is itself a
// repository stays whole. Ignored holds root-relative paths to leave in dir.
func discoverRepositories(dir string, ignored []string) []Discovered {
	if repoMarker(dir) != "" {
		return nil
	}

	skip := map[string]bool{}
	for _, rel := range ignored {
		skip[filepath.ToSlash(filepath.Clean(rel))] = true
	}

	var found []Discovered
	scanForRepositories(dir, "", 1, skip, &found)

	sort.Slice(found, func(i, j int) bool { return found[i].Path < found[j].Path })
	return found
}

func scanForRepositories(dir, rel string, depth int, skip map[string]bool, found *[]Discovered) {
	entries, err := os.ReadDir(filepath.Join(dir, filepath.FromSlash(rel)))
	if err != nil {
		return
	}

	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || strings.HasPrefix(name, ".") || workspace.SkipDir(name) || len(*found) >= maxDiscovered {
			continue
		}

		child := strings.TrimPrefix(rel+"/"+name, "/")
		root := filepath.Join(dir, filepath.FromSlash(child))

		if marker := repoMarker(root); marker != "" {
			if !skip[child] {
				*found = append(*found, Discovered{Root: root, Path: child, Marker: marker})
			}
			continue
		}

		if depth < discoverDepth {
			scanForRepositories(dir, child, depth+1, skip, found)
		}
	}
}

// rootsFor lists the project directory first, then its repositories, each
// with a unique key: the folder name, else its path with '-' for '/'.
func rootsFor(dir string, found []Discovered) []domain.Repo {
	used := map[string]bool{filepath.Base(dir): true}
	roots := []domain.Repo{{Key: filepath.Base(dir), Root: dir}}

	for _, d := range found {
		key := uniqueKey(used, filepath.Base(d.Root), strings.ReplaceAll(d.Path, "/", "-"))
		roots = append(roots, domain.Repo{Key: key, Root: d.Root})
	}

	return roots
}

func uniqueKey(used map[string]bool, preferred, fallback string) string {
	key := preferred
	if used[key] {
		key = fallback
	}

	for n := 2; used[key]; n++ {
		key = fallback + "-" + strconv.Itoa(n)
	}

	used[key] = true
	return key
}

// withKeys fills Discovered keys to match rootsFor.
func withKeys(dir string, found []Discovered) []Discovered {
	roots := rootsFor(dir, found)

	for i := range found {
		found[i].Key = roots[i+1].Key
	}

	return found
}
