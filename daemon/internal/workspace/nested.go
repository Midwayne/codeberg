package workspace

import (
	"path/filepath"
	"strings"
)

// nestedRoots maps each repo key to the root-relative directories of the other
// repos inside it. A project directory and the repositories under it are all
// roots; each file is reported only by the innermost root that holds it.
func nestedRoots(repos []RepoInfo) map[string][]string {
	nested := map[string][]string{}

	for _, outer := range repos {
		for _, inner := range repos {
			if rel, ok := insideRoot(outer.Root, inner.Root); ok {
				nested[outer.Key] = append(nested[outer.Key], rel)
			}
		}
	}

	return nested
}

// insideRoot reports inner relative to outer when it lies strictly inside it.
func insideRoot(outer, inner string) (string, bool) {
	rel, err := filepath.Rel(filepath.Clean(outer), filepath.Clean(inner))
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}

	return filepath.ToSlash(rel), true
}

// nestedPath reports whether slash path rel lies in one of the nested roots.
func nestedPath(nested []string, rel string) bool {
	rel = strings.TrimPrefix(filepath.ToSlash(rel), "./")

	for _, dir := range nested {
		if rel == dir || strings.HasPrefix(rel, dir+"/") {
			return true
		}
	}

	return false
}

// nestedGlobs are ripgrep exclusions anchored at the search root.
func nestedGlobs(nested []string) []string {
	var args []string

	for _, dir := range nested {
		args = append(args, "--glob", "!/"+escapeGlob(dir)+"/**")
	}

	return args
}

func escapeGlob(path string) string {
	var b strings.Builder

	for _, r := range path {
		if strings.ContainsRune(`*?[]{}\!`, r) {
			b.WriteRune('\\')
		}
		b.WriteRune(r)
	}

	return b.String()
}
