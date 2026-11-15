package main

import (
	"fmt"
	"os"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/bootstrap"
	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/console"
	"codeberg.org/codeberg/launcher/internal/registry"
	"codeberg.org/codeberg/launcher/internal/run"
	"codeberg.org/codeberg/launcher/internal/update"
)

func cmdRun(args []string) error {
	o, err := parseShared("run", args)
	if err != nil {
		return err
	}

	c, err := config.Load(*o)
	if err != nil {
		return err
	}

	term := console.New(os.Stderr, console.Interactive(os.Stderr) && !c.Verbose)
	fmt.Fprintf(term, "Codeberg %s\n\n", version)
	writeStarterFiles(c)

	if err := selectEmbedding(c, o); err != nil {
		return err
	}
	if c.All && len(c.Repos) > 0 {
		return fmt.Errorf("--all already serves every registered repo; use --repos to pick a subset instead")
	}
	if err := c.ValidateForRun(); err != nil {
		return err
	}

	_, prebuilt := c.ResolveRoot()
	stopUpdateCheck := update.Start(version, prebuilt, term)
	defer stopUpdateCheck()

	if err := resolveRoots(c); err != nil {
		return err
	}
	if err := bootstrap.Ensure(c, false); err != nil {
		return err
	}

	return run.Run(c, term)
}

// writeStarterFiles creates template config files on first run so there is an
// obvious place to edit.
func writeStarterFiles(c *config.Config) {
	if created, _ := config.InitFile(c.ConfigPath); created {
		fmt.Fprintf(os.Stderr, "› wrote a starter config at %s\n", c.ConfigPath)
	}

	if created, _ := config.InitMcpFile(mcpConfigPath(c)); created {
		fmt.Fprintf(os.Stderr, "› wrote a starter MCP config at %s\n", mcpConfigPath(c))
	}
}

func mcpConfigPath(c *config.Config) string {
	return filepath.Join(c.Home, "mcp.json")
}

// resolveRoots fills c.Roots with the repositories this run serves. With no
// --all, --repos, or --root, projects come from the browser catalog instead.
func resolveRoots(c *config.Config) error {
	switch {
	case c.All:
		return useRegisteredRoots(c)

	case len(c.Repos) > 0:
		// A chosen set of dirs and/or registered keys.
		return useSelectedRoots(c, c.Repos)

	case c.Root != "":
		return useStartupRoot(c)
	}

	return nil
}

// useRegisteredRoots serves every registered repo whose directory still exists.
func useRegisteredRoots(c *config.Config) error {
	entries, err := registry.Load(c.Home)
	if err != nil {
		return err
	}

	for _, e := range entries {
		if !isDir(e.Root) {
			fmt.Fprintf(os.Stderr, "warning: skipping %s — %s no longer exists\n", e.Key, e.Root)
			continue
		}

		c.Roots = append(c.Roots, e)
	}

	if len(c.Roots) == 0 {
		return fmt.Errorf("no repos registered yet — run `codeberg <dir>` (or --root <dir>) first, then `codeberg --all`")
	}

	return nil
}

// useSelectedRoots serves the named dirs and registry keys. Dirs are
// registered like any other run, unless --no-index makes this a
// leave-no-trace session.
func useSelectedRoots(c *config.Config, names []string) error {
	roots, err := registry.Select(c.Home, names, !c.NoIndex)
	if err != nil {
		return err
	}

	c.Roots = roots
	return nil
}

// useStartupRoot serves --root. A single indexed root is soft-registered so
// --all can find it later, and a registry failure does not stop the run.
func useStartupRoot(c *config.Config) error {
	paths := config.RootPaths(c.Root)
	if c.NoIndex || len(paths) != 1 {
		return useSelectedRoots(c, paths)
	}

	entry, err := registry.Upsert(c.Home, paths[0])
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: could not update the repo registry: %v\n", err)
		entry = registry.Entry{Key: filepath.Base(paths[0]), Root: paths[0]}
	}

	c.Roots = []registry.Entry{entry}
	return nil
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
