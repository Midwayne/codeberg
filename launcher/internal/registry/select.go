package registry

import (
	"fmt"
	"os"
	"strings"
)

// Select resolves a user-given repo list — directory paths and/or registry
// keys — into entries, preserving input order and deduping by resolved root.
// A directory is registered via Upsert unless register is false, in which
// case an unregistered path gets a session-only entry (basename key,
// disambiguated within the selection) and the registry file is not touched;
// an already-registered path reuses its registered key either way. A key must
// name a registered repo whose root still exists. Paths win over keys when an
// item could be read as both.
func Select(home string, items []string, register bool) ([]Entry, error) {
	entries, err := Load(home)
	if err != nil {
		return nil, err
	}

	sel := newSelection(home, entries, register)
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}

		if err := sel.addItem(item); err != nil {
			return nil, err
		}
	}

	if len(sel.out) == 0 {
		return nil, fmt.Errorf("registry: no repos selected")
	}

	return sel.out, nil
}

// selection accumulates the entries chosen by Select.
type selection struct {
	home     string
	register bool

	byKey  map[string]Entry
	byRoot map[string]Entry
	taken  map[string]bool // keys in use, registered or session-only

	seen map[string]bool // roots already selected
	out  []Entry
}

func newSelection(home string, entries []Entry, register bool) *selection {
	sel := &selection{
		home:     home,
		register: register,
		byKey:    map[string]Entry{},
		byRoot:   map[string]Entry{},
		taken:    map[string]bool{},
		seen:     map[string]bool{},
	}

	for _, e := range entries {
		sel.byKey[e.Key] = e
		sel.byRoot[e.Root] = e
		sel.taken[e.Key] = true
	}

	return sel
}

// addItem selects one path or key; paths win when an item could be both.
func (sel *selection) addItem(item string) error {
	if fi, err := os.Stat(item); err == nil && fi.IsDir() {
		return sel.addDir(item)
	}

	e, ok := sel.byKey[item]
	if !ok {
		return fmt.Errorf("registry: %q is neither a directory nor a registered repo key (list them with `codeberg repos`)", item)
	}

	if fi, err := os.Stat(e.Root); err != nil || !fi.IsDir() {
		return fmt.Errorf("registry: repo %q: root no longer exists: %s", item, e.Root)
	}

	sel.add(e)
	return nil
}

// addDir selects a directory, registering it unless this is a session-only
// selection.
func (sel *selection) addDir(dir string) error {
	if sel.register {
		e, err := Upsert(sel.home, dir)
		if err != nil {
			return err
		}

		sel.add(e)
		return nil
	}

	resolved, err := resolveRoot(dir)
	if err != nil {
		return err
	}

	if e, ok := sel.byRoot[resolved]; ok {
		sel.add(e)
		return nil
	}

	sel.add(Entry{Key: deriveKey(resolved, sel.taken), Root: resolved})
	return nil
}

// add appends e unless its root is already selected.
func (sel *selection) add(e Entry) {
	if sel.seen[e.Root] {
		return
	}

	sel.seen[e.Root] = true
	sel.taken[e.Key] = true
	sel.out = append(sel.out, e)
}
