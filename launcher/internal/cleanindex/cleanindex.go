// Package cleanindex prunes the per-directory vector index files the core
// leaves under the launcher's index dir. Each indexed root gets its own set —
// "<base>.<roothash>" plus ".chunks"/".manifest" (and a transient ".rebuild")
// sidecars — so hopping across many repos slowly accumulates them. This removes
// those sets to reclaim space; the active repo simply re-embeds on the next run.
package cleanindex

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"codeberg.org/codeberg/launcher/internal/config"
)

// Options controls behaviour.
type Options struct {
	DryRun    bool
	AssumeYes bool
}

const tagLen = 17 // ".<16 hex>"

// inventory is every cached index file found, grouped into per-root sets.
type inventory struct {
	bases []string         // index base paths that were searched
	files []string         // every cached file under those bases
	sets  map[string]int64 // set label → total bytes
}

// Run lists the cached index sets and (unless DryRun) removes them.
func Run(c *config.Config, o Options) error {
	dir := filepath.Dir(c.IndexPath)

	inv, err := collect(c)
	if err != nil {
		return err
	}

	if len(inv.files) == 0 {
		fmt.Printf("no cached index files under %s or project directories\n", dir)
		return nil
	}

	report(dir, inv)

	if o.DryRun {
		fmt.Println("(dry run — nothing removed)")
		return nil
	}

	question := fmt.Sprintf("Remove all %d cached index set(s)? The active repo will re-embed on next run.", len(inv.sets))
	if !confirm(question, o.AssumeYes) {
		fmt.Println("  kept")
		return nil
	}

	remove(inv)
	return nil
}

// indexBases returns the launcher's own index base plus one per project.
func indexBases(c *config.Config) ([]string, error) {
	projectDirs, err := filepath.Glob(filepath.Join(c.Home, "projects", "p-*", "index"))
	if err != nil {
		return nil, err
	}

	bases := []string{c.IndexPath}
	for _, projectDir := range projectDirs {
		bases = append(bases, filepath.Join(projectDir, "codeberg.usearch"))
	}

	return bases, nil
}

// collect finds the cached files under every index base. Sets from project
// directories are labelled "<project>:<tag>" to tell them apart.
func collect(c *config.Config) (inventory, error) {
	bases, err := indexBases(c)
	if err != nil {
		return inventory{}, err
	}

	inv := inventory{bases: bases, sets: map[string]int64{}}
	seen := map[string]bool{}

	for _, base := range bases {
		if seen[base] {
			continue
		}
		seen[base] = true

		files, err := filepath.Glob(base + ".*")
		if err != nil {
			return inventory{}, err
		}
		if info, err := os.Stat(base); err == nil && info.Mode().IsRegular() {
			files = append(files, base)
		}
		inv.files = append(inv.files, files...)

		for tag, size := range group(base, files) {
			if base != c.IndexPath {
				tag = filepath.Base(filepath.Dir(filepath.Dir(base))) + ":" + tag
			}
			inv.sets[tag] += size
		}
	}

	return inv, nil
}

// report prints each set's size and the totals.
func report(dir string, inv inventory) {
	tags := make([]string, 0, len(inv.sets))
	for tag := range inv.sets {
		tags = append(tags, tag)
	}
	sort.Strings(tags)

	var total int64
	fmt.Printf("cached index sets under %s and project directories:\n", dir)
	for _, tag := range tags {
		total += inv.sets[tag]
		fmt.Printf("  %-18s %s\n", tag, human(inv.sets[tag]))
	}

	fmt.Printf("total: %d set(s), %d file(s), %s\n", len(inv.sets), len(inv.files), human(total))
}

// remove deletes every cached file, then any cache directory left empty.
func remove(inv inventory) {
	var freed int64
	removed := 0

	for _, f := range inv.files {
		if fi, statErr := os.Stat(f); statErr == nil {
			freed += fi.Size()
		}

		if rmErr := os.Remove(f); rmErr != nil {
			fmt.Printf("  could not remove %s: %v\n", f, rmErr)
			continue
		}
		removed++
	}

	// os.Remove only deletes a directory that is already empty.
	for _, base := range inv.bases {
		_ = os.Remove(filepath.Dir(base))
	}

	fmt.Printf("✓ removed %d file(s), freed %s\n", removed, human(freed))
}

// group maps each per-root tag (".<16 hex>") to the total size of its files.
func group(base string, matches []string) map[string]int64 {
	sets := map[string]int64{}
	for _, f := range matches {
		rest := strings.TrimPrefix(f, base) // ".<tag>[.chunks|.manifest|.rebuild]"
		tag := rest
		if len(rest) >= tagLen {
			tag = rest[:tagLen]
		}
		var size int64
		if fi, err := os.Stat(f); err == nil {
			size = fi.Size()
		}
		sets[tag] += size
	}
	return sets
}
