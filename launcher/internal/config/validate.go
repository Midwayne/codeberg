package config

import (
	"fmt"
	"os"
	"strings"
)

// ValidateForRun checks the fields required to actually launch.
func (c *Config) ValidateForRun() error {
	if root, _ := c.ResolveRoot(); root == "" {
		return fmt.Errorf("could not locate codeberg's components — neither a prebuilt install (%s) nor a source checkout with core/, daemon/ and agent/ (%s).\n"+
			"Note this is about the launcher's OWN files, NOT %s (the repo you want to index).\n"+
			"Install via Homebrew, or run codeberg from inside a checkout / set it: codeberg config set %s=/path/to/codeberg  (or pass --repo).",
			KeyDist, KeyRepo, "--root", KeyRepo)
	}
	if c.Root != "" && (c.All || len(c.Repos) > 0) {
		return fmt.Errorf("--root cannot be combined with --all or --repos")
	}
	if c.Root != "" {
		if paths := RootPaths(c.Root); len(paths) == 0 {
			return fmt.Errorf("--root is empty or invalid")
		} else {
			for _, path := range paths {
				if fi, err := os.Stat(path); err != nil || !fi.IsDir() {
					return fmt.Errorf("--root is not a directory: %s", path)
				}
			}
		}
	}
	// The browser shell and setup docs remain available before model setup.
	if c.Model != "" && !strings.Contains(c.Model, ":") {
		return fmt.Errorf("%s must be provider:model, got %q", KeyModel, c.Model)
	}
	if c.SubagentModel != "" && !strings.Contains(c.SubagentModel, ":") {
		return fmt.Errorf("%s must be provider:model, got %q", KeySubagentModel, c.SubagentModel)
	}

	return nil
}
