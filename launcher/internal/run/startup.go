package run

import (
	"fmt"
	"strings"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/console"
)

// announceStartup reports the wait for the daemon. Normal runs show one status
// line; verbose runs describe the roots and mirror the daemon log below.
// The returned function ends the status.
func announceStartup(term *console.Terminal, c *config.Config, logPath string) (stop func()) {
	if !c.Verbose {
		return term.Start(startupLabel(c))
	}

	switch {
	case c.All || len(c.Repos) > 0 || len(c.Roots) > 1:
		fmt.Fprintf(term, "› starting daemon — indexing %d repo(s): %s\n", len(c.Roots), strings.Join(rootKeys(c), ", "))
	case len(c.Roots) == 1:
		fmt.Fprintf(term, "› starting daemon — indexing %s\n", c.Roots[0].Root)
	default:
		fmt.Fprintln(term, "› starting daemon — open the browser to add a project")
	}

	if c.NoIndex {
		fmt.Fprintf(term, "  (--no-index: nothing registered or written; semantic search is off this run — full log: %s)\n\n", logPath)
	} else if len(c.Roots) > 0 {
		fmt.Fprintf(term, "  (first run builds the index; live progress below — full log: %s)\n\n", logPath)
	}

	return func() {}
}

func startupLabel(c *config.Config) string {
	if len(c.Roots) == 0 {
		return "Starting Codeberg"
	}

	return "Starting Codeberg and indexing " + strings.Join(rootKeys(c), ", ")
}

func rootKeys(c *config.Config) []string {
	keys := make([]string, 0, len(c.Roots))
	for _, r := range c.Roots {
		keys = append(keys, r.Key)
	}

	return keys
}

func readyMessage(url string) string {
	return fmt.Sprintf("✓ Ready at %s\n  Opening your browser. Press Ctrl-C to stop.\n\n", url)
}
