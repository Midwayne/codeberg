package git

import (
	"sort"
	"strconv"
	"strings"
)

// ParseDiffHunks maps path -> set of changed 1-based line numbers from
// unified diff output (typically git diff -U0).
func ParseDiffHunks(diff string) map[string]map[uint32]struct{} {
	out := map[string]map[uint32]struct{}{}
	var path string
	for _, line := range strings.Split(diff, "\n") {
		if strings.HasPrefix(line, "+++ b/") {
			path = strings.TrimPrefix(line, "+++ b/")
			if _, ok := out[path]; !ok {
				out[path] = map[uint32]struct{}{}
			}
			continue
		}
		if strings.HasPrefix(line, "+++ /dev/null") {
			path = ""
			continue
		}
		if !strings.HasPrefix(line, "@@") || path == "" {
			continue
		}
		// @@ -a,b +c,d @@  or  @@ -a +c @@
		plus := strings.Index(line, "+")
		if plus < 0 {
			continue
		}
		rest := line[plus+1:]
		end := strings.IndexAny(rest, " ,")
		if end < 0 {
			continue
		}
		startStr := rest[:end]
		start, err := strconv.ParseUint(startStr, 10, 32)
		if err != nil || start == 0 {
			continue
		}
		count := uint64(1)
		if end < len(rest) && rest[end] == ',' {
			after := rest[end+1:]
			cend := strings.IndexAny(after, " @")
			if cend < 0 {
				cend = len(after)
			}
			if c, e := strconv.ParseUint(after[:cend], 10, 32); e == nil {
				count = c
			}
		}
		if count == 0 {
			// Pure deletion hunk — treat the surrounding line as touched.
			count = 1
		}
		for i := uint64(0); i < count; i++ {
			out[path][uint32(start+i)] = struct{}{}
		}
	}
	return out
}

// DiffPaths returns changed paths in sorted order from a ParseDiffHunks map.
func DiffPaths(hunks map[string]map[uint32]struct{}) []string {
	if len(hunks) == 0 {
		return nil
	}
	paths := make([]string, 0, len(hunks))
	for p := range hunks {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	return paths
}
