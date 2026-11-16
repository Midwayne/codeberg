// Package registry remembers every repository root codeberg has been run
// against — one "<key>\t<absolute path>" record per line in <home>/repos — so
// `codeberg --all` can boot the whole set. The key (the root's basename,
// suffixed with a short path hash on collision) is the repo's human-facing
// identity: it appears in CODEBERG_ROOTS, search results, and tool arguments.
package registry

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Entry is one registered repository: a stable human-facing key and the
// resolved (symlink-free, absolute) root it names.
type Entry struct {
	Key  string
	Root string
}

// Path returns the registry file inside home.
func Path(home string) string { return filepath.Join(home, "repos") }

// Load reads the registry. A missing file is an empty registry. Malformed
// lines are skipped, as are records repeating an earlier key or root, so a
// hand-edited file cannot produce ambiguous lookups. Entries are returned in
// file order; roots are not checked for existence (a temporarily unmounted
// tree keeps its registration).
func Load(home string) ([]Entry, error) {
	f, err := os.Open(Path(home))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	var entries []Entry
	seenKey := map[string]bool{}
	seenRoot := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, root, ok := strings.Cut(line, "\t")
		key, root = strings.TrimSpace(key), strings.TrimSpace(root)
		if !ok || key == "" || root == "" || seenKey[key] || seenRoot[root] {
			continue
		}
		seenKey[key], seenRoot[root] = true, true
		entries = append(entries, Entry{Key: key, Root: root})
	}
	return entries, sc.Err()
}

// Upsert registers root, resolving it to its real absolute path first (the
// path is the repo's identity — a symlinked alias maps to the same entry).
// An already-registered root returns its existing entry unchanged; a new one
// is appended under its basename, disambiguated with a short path-hash suffix
// when another repo already claimed that name.
func Upsert(home, root string) (Entry, error) {
	resolved, err := resolveRoot(root)
	if err != nil {
		return Entry{}, err
	}
	entries, err := Load(home)
	if err != nil {
		return Entry{}, err
	}
	taken := map[string]bool{}
	for _, e := range entries {
		if e.Root == resolved {
			return e, nil
		}
		taken[e.Key] = true
	}
	e := Entry{Key: deriveKey(resolved, taken), Root: resolved}
	if err := appendEntry(home, e); err != nil {
		return Entry{}, err
	}
	return e, nil
}

func resolveRoot(root string) (string, error) {
	a, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	r, err := filepath.EvalSymlinks(a)
	if err != nil {
		return "", err
	}
	fi, err := os.Stat(r)
	if err != nil {
		return "", err
	}
	if !fi.IsDir() {
		return "", fmt.Errorf("registry: not a directory: %s", root)
	}
	return r, nil
}

// deriveKey names a repo after its directory. On a basename collision the key
// gains a short digest of the full path — stable across runs, so two
// same-named checkouts stay distinguishable. Keys must survive the
// tab-separated record format, so whitespace that would split a record is
// mapped away.
func deriveKey(resolved string, taken map[string]bool) string {
	base := strings.Map(func(r rune) rune {
		switch r {
		case '\t', '\n', '\r':
			return '-'
		}
		return r
	}, filepath.Base(resolved))
	if !taken[base] {
		return base
	}
	sum := sha256.Sum256([]byte(resolved))
	tag := hex.EncodeToString(sum[:])
	for n := 6; n <= len(tag); n += 6 {
		if key := base + "-" + tag[:n]; !taken[key] {
			return key
		}
	}
	return base + "-" + tag
}

// appendEntry rewrites the registry atomically (temp + rename), preserving
// existing lines — including comments — verbatim.
func appendEntry(home string, e Entry) error {
	if err := os.MkdirAll(home, 0o755); err != nil {
		return err
	}
	path := Path(home)
	prior, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if len(prior) > 0 && prior[len(prior)-1] != '\n' {
		prior = append(prior, '\n')
	}
	record := append(prior, []byte(e.Key+"\t"+e.Root+"\n")...)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, record, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
