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
	Root   string
	Path   string
	Marker string
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
// repository stays whole.
func discoverRepositories(dir string) []Discovered {
	if repoMarker(dir) != "" {
		return nil
	}

	var found []Discovered
	scanForRepositories(dir, "", 1, &found)

	sort.Slice(found, func(i, j int) bool { return found[i].Path < found[j].Path })
	return found
}

func scanForRepositories(dir, rel string, depth int, found *[]Discovered) {
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
			*found = append(*found, Discovered{Root: root, Path: child, Marker: marker})
			continue
		}

		if depth < discoverDepth {
			scanForRepositories(dir, child, depth+1, found)
		}
	}
}

// rootsFor lists the project directory first, then its repositories, each
// with a unique key: the folder name, else its path with '-' for '/'.
func rootsFor(dir string, found []Discovered) []domain.Repo {
	return rootsWithKey(dir, filepath.Base(dir), found)
}

// rootsWithKey is rootsFor with the project directory's key chosen by the caller.
func rootsWithKey(dir, key string, found []Discovered) []domain.Repo {
	used := map[string]bool{key: true}
	roots := []domain.Repo{{Key: key, Root: dir}}

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
