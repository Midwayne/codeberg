// Package cleanindex removes cached vector-index files the daemon reports.
// The active repo rebuilds its index on the next run.
package cleanindex

import (
	"bufio"
	"fmt"
	"os"
	"sort"
	"strings"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/daemonapi"
)

// Options controls behaviour.
type Options struct {
	DryRun    bool
	AssumeYes bool
}

// loadReport is replaced in tests.
var loadReport = func(c *config.Config) (daemonapi.Report, error) {
	root, _ := c.ResolveRoot()
	return daemonapi.Storage(daemonapi.Binary(root), c.Home)
}

// Run lists the cached index sets and (unless DryRun) removes them.
func Run(c *config.Config, o Options) error {
	report, err := loadReport(c)
	if err != nil {
		return err
	}

	sets := setSizes(report)
	if len(sets) == 0 {
		fmt.Printf("no cached index files under %s\n", c.Home)
		return nil
	}

	printSets(sets)
	if o.DryRun {
		fmt.Println("(dry run — nothing removed)")
		return nil
	}

	if !confirm(fmt.Sprintf("Remove all %d cached index set(s)? The active repo will re-embed on next run.", len(sets)), o.AssumeYes) {
		fmt.Println("  kept")
		return nil
	}

	removed, freed := removeFiles(report)
	fmt.Printf("✓ removed %d file(s), freed %s\n", removed, human(freed))
	return nil
}

type sizedSet struct {
	name  string
	bytes int64
	files int
}

func setSizes(report daemonapi.Report) []sizedSet {
	sets := make([]sizedSet, 0, len(report.IndexSets))

	for _, set := range report.IndexSets {
		if len(set.Files) == 0 {
			continue
		}

		var total int64
		for _, file := range set.Files {
			if info, err := os.Stat(file); err == nil {
				total += info.Size()
			}
		}

		sets = append(sets, sizedSet{name: set.Name, bytes: total, files: len(set.Files)})
	}

	sort.Slice(sets, func(i, j int) bool { return sets[i].name < sets[j].name })
	return sets
}

func printSets(sets []sizedSet) {
	var total int64
	files := 0

	fmt.Println("cached index sets:")
	for _, set := range sets {
		total += set.bytes
		files += set.files
		fmt.Printf("  %-18s %s\n", set.name, human(set.bytes))
	}

	fmt.Printf("total: %d set(s), %d file(s), %s\n", len(sets), files, human(total))
}

func removeFiles(report daemonapi.Report) (int, int64) {
	removed := 0
	var freed int64

	for _, set := range report.IndexSets {
		for _, file := range set.Files {
			if info, err := os.Stat(file); err == nil {
				freed += info.Size()
			}

			if err := os.Remove(file); err != nil {
				fmt.Printf("  could not remove %s: %v\n", file, err)
				continue
			}

			removed++
		}
	}

	return removed, freed
}

func confirm(question string, assumeYes bool) bool {
	if assumeYes {
		fmt.Printf("%s [y/N] y (--yes)\n", question)
		return true
	}

	if info, err := os.Stdin.Stat(); err != nil || info.Mode()&os.ModeCharDevice == 0 {
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
