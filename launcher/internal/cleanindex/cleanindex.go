// Package cleanindex prunes the per-directory vector index files the core
// leaves under the launcher's index dir. Each indexed root gets its own set —
// "<base>.<roothash>" plus ".chunks"/".manifest" (and a transient ".rebuild")
// sidecars — so hopping across many repos slowly accumulates them. This removes
// those sets to reclaim space; the active repo simply re-embeds on the next run.
package cleanindex

import (
	"bufio"
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

// Run lists the cached index sets and (unless DryRun) removes them.
func Run(c *config.Config, o Options) error {
	dir := filepath.Dir(c.IndexPath)
	bases := []string{c.IndexPath}
	projectDirs, err := filepath.Glob(filepath.Join(c.Home, "projects", "p-*", "index"))
	if err != nil {
		return err
	}
	for _, projectDir := range projectDirs {
		bases = append(bases, filepath.Join(projectDir, "codeberg.usearch"))
	}
	var matches []string
	sets := map[string]int64{}
	seen := map[string]bool{}
	for _, base := range bases {
		if seen[base] {
			continue
		}
		seen[base] = true
		files, err := filepath.Glob(base + ".*")
		if err != nil {
			return err
		}
		if info, err := os.Stat(base); err == nil && info.Mode().IsRegular() {
			files = append(files, base)
		}
		matches = append(matches, files...)
		for tag, size := range group(base, files) {
			if base != c.IndexPath {
				tag = filepath.Base(filepath.Dir(filepath.Dir(base))) + ":" + tag
			}
			sets[tag] += size
		}
	}
	if len(matches) == 0 {
		fmt.Printf("no cached index files under %s or project directories\n", dir)
		return nil
	}

	tags := make([]string, 0, len(sets))
	for tag := range sets {
		tags = append(tags, tag)
	}
	sort.Strings(tags)

	var total int64
	fmt.Printf("cached index sets under %s and project directories:\n", dir)
	for _, tag := range tags {
		total += sets[tag]
		fmt.Printf("  %-18s %s\n", tag, human(sets[tag]))
	}
	fmt.Printf("total: %d set(s), %d file(s), %s\n", len(sets), len(matches), human(total))

	if o.DryRun {
		fmt.Println("(dry run — nothing removed)")
		return nil
	}
	if !confirm(fmt.Sprintf("Remove all %d cached index set(s)? The active repo will re-embed on next run.", len(sets)), o.AssumeYes) {
		fmt.Println("  kept")
		return nil
	}

	var freed int64
	removed := 0
	for _, f := range matches {
		if fi, statErr := os.Stat(f); statErr == nil {
			freed += fi.Size()
		}
		if rmErr := os.Remove(f); rmErr != nil {
			fmt.Printf("  could not remove %s: %v\n", f, rmErr)
			continue
		}
		removed++
	}
	for _, base := range bases {
		_ = os.Remove(filepath.Dir(base))
	} // only empty cache directories
	fmt.Printf("✓ removed %d file(s), freed %s\n", removed, human(freed))
	return nil
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

func confirm(question string, assumeYes bool) bool {
	if assumeYes {
		fmt.Printf("%s [y/N] y (--yes)\n", question)
		return true
	}
	if fi, err := os.Stdin.Stat(); err != nil || fi.Mode()&os.ModeCharDevice == 0 {
		fmt.Printf("%s [y/N] n (non-interactive)\n", question)
		return false
	}
	fmt.Printf("%s [y/N] ", question)
	line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	}
	return false
}

// human renders a byte count compactly.
func human(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for x := n / unit; x >= unit; x /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}
