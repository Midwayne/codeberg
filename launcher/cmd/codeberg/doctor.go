package main

import (
	"fmt"
	"os"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/searxng"
)

func cmdDoctor(args []string) error {
	o, err := parseShared("doctor", args)
	if err != nil {
		return err
	}

	c, err := config.Load(*o)
	if err != nil {
		return err
	}

	reportRuntime(c)
	reportComponents(c)
	reportWebSearch(c)
	reportDatabaseMCP(c)

	fmt.Println("\nResolved config:")
	fmt.Print(c.Summary())
	return nil
}

func reportComponents(c *config.Config) {
	fmt.Println("\nComponents:")

	root, prebuilt := c.ResolveRoot()
	switch {
	case prebuilt:
		fmt.Printf("  ✓ prebuilt install: %s\n", root)
	case c.Dist != "":
		fmt.Printf("  ✘ prebuilt install: %s (incomplete — binaries missing)\n", c.Dist)
	}

	if c.Repo != "" {
		fmt.Printf("  ✓ source checkout: %s\n", c.Repo)
	} else if !prebuilt {
		fmt.Println("  ✘ source checkout: not found (set CODEBERG_REPO/--repo)")
	}

	if root != "" {
		artifacts := config.LocateArtifacts(root)
		reportFile("cberg-index (core)", artifacts.IndexBin)
		reportFile("codeberg-d (daemon)", artifacts.DaemonBin)
		reportFile("agent web UI", artifacts.WebScript)
	}

	if c.Vector {
		reportFile("embedding model", c.EmbedModel)
	}
}

func reportWebSearch(c *config.Config) {
	fmt.Println("\nWeb search (web_search):")

	switch {
	case !c.WebUse:
		fmt.Println("  • disabled (CODEBERG_WEB_USE=false) — fetch_url also off")
	case !c.WebSearchUse:
		fmt.Println("  • off by default — enable in Settings → Tools (saved browser preference takes precedence)")
	case c.SearxngURL != "":
		fmt.Printf("  ✓ external SearXNG: %s\n", c.SearxngURL)
	case searxng.Installed(c.Home):
		fmt.Printf("  ✓ managed SearXNG installed (%s) — runs on :%s with codeberg\n",
			filepath.Join(c.Home, "searxng"), c.SearxngPort)
	case searxng.Available():
		fmt.Println("  ✘ not installed yet — `codeberg build` (or the next run) installs it")
	default:
		fmt.Println("  ✘ python3 not found — install it to enable web_search (fetch_url still works)")
	}
}

func reportDatabaseMCP(c *config.Config) {
	fmt.Println("\nDatabase MCP (multi-db):")

	if !c.DbmcpUse {
		fmt.Println("  • disabled — set CODEBERG_DBMCP_USE=true and add spec.yml to the config directory")
		return
	}

	if spec, found := c.DbmcpSpecFile(); found {
		fmt.Printf("  ✓ spec %s\n", spec)
	} else {
		fmt.Printf("  ✘ spec missing (%s)\n", spec)
	}

	if root, _ := c.ResolveRoot(); root != "" || c.DbmcpBin != "" {
		reportFile("dbmcp", c.DbmcpBinary())
	} else {
		fmt.Println("  ✘ dbmcp binary unknown — set CODEBERG_DBMCP_BIN or run from a checkout")
	}
}

func reportFile(label, path string) {
	if _, err := os.Stat(path); err == nil {
		fmt.Printf("  ✓ %-22s %s\n", label, path)
	} else {
		fmt.Printf("  ✘ %-22s missing (%s) — run `codeberg build`\n", label, path)
	}
}
