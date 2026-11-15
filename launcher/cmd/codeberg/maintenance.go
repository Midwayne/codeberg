package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"

	"codeberg.org/codeberg/launcher/internal/cleanindex"
	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/registry"
	"codeberg.org/codeberg/launcher/internal/uninstall"
)

func cmdCleanIndex(args []string) error {
	fs := flag.NewFlagSet("clean-index", flag.ContinueOnError)
	var home, cfg string
	var dryRun, yes bool
	fs.StringVar(&home, "home", "", "managed home dir (default ~/.codeberg)")
	fs.StringVar(&cfg, "config", "", "config file path (default <home>/config)")
	fs.BoolVar(&dryRun, "dry-run", false, "list what would be removed, delete nothing")
	fs.BoolVar(&yes, "yes", false, "assume yes (non-interactive)")
	fs.BoolVar(&yes, "y", false, "alias for --yes")
	fs.Usage = func() {
		fmt.Fprint(fs.Output(), "Usage: codeberg clean-index [--dry-run] [--yes]\n\n"+
			"Removes cached per-directory vector index files under the index dir to\n"+
			"reclaim space. Prunes all sets (the active repo re-embeds next run).\n")
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	c, err := config.Load(config.Overrides{Home: home, ConfigFile: cfg})
	if err != nil {
		return err
	}
	return cleanindex.Run(c, cleanindex.Options{DryRun: dryRun, AssumeYes: yes})
}

func cmdRepos(args []string) error {
	fs := flag.NewFlagSet("repos", flag.ContinueOnError)
	var home string
	fs.StringVar(&home, "home", "", "managed home dir (default ~/.codeberg)")
	fs.Usage = func() {
		fmt.Fprint(fs.Output(), "Usage: codeberg repos\n\n"+
			"Lists every repository codeberg has indexed (the set `--all` searches).\n"+
			"Repos register automatically on each run; edit "+
			"the registry file to drop one.\n")
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	c, err := config.Load(config.Overrides{Home: home})
	if err != nil {
		return err
	}
	entries, err := registry.Load(c.Home)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		fmt.Printf("no repos registered yet — run `codeberg --root <dir>` (or `codeberg <dir>`) first\n")
		return nil
	}
	for _, e := range entries {
		mark := "✓"
		if !isDir(e.Root) {
			mark = "✘"
		}
		fmt.Printf("  %s %-24s %s\n", mark, e.Key, e.Root)
	}
	fmt.Printf("\n%d repo(s) in %s — `codeberg --all` searches the ✓ ones combined\n",
		len(entries), registry.Path(c.Home))
	return nil
}

func cmdUninstall(args []string) error {
	fs := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	var home string
	var yes, removeONNX bool
	fs.StringVar(&home, "home", "", "managed home dir (default ~/.codeberg)")
	fs.BoolVar(&yes, "yes", false, "assume yes for the launcher's own assets (non-interactive)")
	fs.BoolVar(&yes, "y", false, "alias for --yes")
	fs.BoolVar(&removeONNX, "remove-system-onnx", false, "also remove the shared system ONNX runtime (brew)")
	fs.Usage = func() {
		fmt.Fprint(fs.Output(), "Usage: codeberg uninstall [--home DIR] [--yes] [--remove-system-onnx]\n\n"+
			"Removes the `codeberg` command from PATH, then asks before deleting the\n"+
			"embedding model/ONNX weights and launcher data. The shared system ONNX\n"+
			"runtime is only removed on an interactive yes or with --remove-system-onnx\n"+
			"(--yes does not cover it).\n")
	}
	if err := fs.Parse(args); err != nil {
		return err
	}
	c, err := config.Load(config.Overrides{Home: home})
	if err != nil {
		return err
	}
	return uninstall.Run(c, uninstall.Options{AssumeYes: yes, RemoveSystemONNX: removeONNX})
}

// cmdLearning forwards to the agent's learning CLI.
func cmdLearning(args []string) error {
	c, err := config.Load(config.Overrides{})
	if err != nil {
		return err
	}
	root, _ := c.ResolveRoot()
	if root == "" {
		return fmt.Errorf("could not locate codeberg installation")
	}
	script := config.LocateArtifacts(root).LearningScript
	if _, err := os.Stat(script); err != nil {
		return fmt.Errorf("learning CLI is not built at %s; run codeberg build", script)
	}
	node, err := c.NodeBinary()
	if err != nil {
		return err
	}
	command := exec.Command(node, append([]string{script}, args...)...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.Env = append(os.Environ(), config.KeyHome+"="+c.Home)
	return command.Run()
}
