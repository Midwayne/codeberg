package main

import (
	"flag"
	"fmt"

	"codeberg.org/codeberg/launcher/internal/config"
)

// switches holds the boolean flags until parsing finishes, since only the
// ones that were given become overrides.
type switches struct {
	noVector, vector, all, noIndex, verbose *bool
}

// parseShared parses args into overrides, wiring the --vector/--no-vector pair.
func parseShared(name string, args []string) (*config.Overrides, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	o := &config.Overrides{}

	addValueFlags(fs, o)
	sw := addSwitches(fs)

	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "Usage: codeberg %s [flags]\n\nFlags:\n", name)
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return nil, err
	}

	applySwitches(o, sw)
	return o, nil
}

func addValueFlags(fs *flag.FlagSet, o *config.Overrides) {
	fs.StringVar(&o.Root, "root", "", "optional startup repository tree to index")
	fs.StringVar(&o.Repos, "repos", "", "comma-separated dirs or repo keys to serve together (CODEBERG_REPOS)")
	fs.StringVar(&o.Model, "model", "", "LLM as provider:model (CODEBERG_MODEL)")
	fs.StringVar(&o.SubagentModel, "subagent-model", "", "background/subagent LLM as provider:model")
	fs.StringVar(&o.DaemonURL, "daemon-url", "", "daemon URL the agent queries")
	fs.StringVar(&o.HTTPPort, "port", "", "daemon HTTP port (default 48080)")
	fs.StringVar(&o.EmbedModel, "embed-model", "", "embedding model .onnx path")
	fs.StringVar(&o.Embedding, "embedding", "", "embedding model ID (choose interactively on first run)")
	fs.StringVar(&o.IndexPath, "index-path", "", "vector index base path")
	fs.StringVar(&o.Socket, "socket", "", "cberg-index IPC socket path")
	fs.StringVar(&o.Reasoning, "reasoning", "", "reasoning effort (low|medium|high|…)")
	fs.StringVar(&o.Repo, "repo", "", "source checkout to build/run")
	fs.StringVar(&o.Dist, "dist", "", "prebuilt artifact dir to run (CODEBERG_DIST)")
	fs.StringVar(&o.Home, "home", "", "managed home dir (default ~/.codeberg)")
	fs.StringVar(&o.ConfigFile, "config", "", "config file path (default <home>/config)")
	fs.StringVar(&o.WebPort, "web-port", "", "web UI port (default "+config.DefaultWebPort+")")
}

func addSwitches(fs *flag.FlagSet) switches {
	return switches{
		noVector: fs.Bool("no-vector", false, "skip embedding model and semantic search tools"),
		vector:   fs.Bool("vector", false, "force vector search on"),
		all:      fs.Bool("all", false, "search across every previously indexed repo (see `codeberg repos`)"),
		noIndex:  fs.Bool("no-index", false, "one-off run: register nothing, build no vector index (search off)"),
		verbose:  fs.Bool("verbose", false, "show component checks and daemon/indexer logs during startup (CODEBERG_VERBOSE)"),
	}
}

// applySwitches turns only the switches that were given into overrides; the
// rest stay nil so the environment and config file still apply. --vector wins
// over --no-vector.
func applySwitches(o *config.Overrides, sw switches) {
	if *sw.noVector {
		o.Vector = ptr(false)
	}
	if *sw.vector {
		o.Vector = ptr(true)
	}
	if *sw.all {
		o.All = ptr(true)
	}
	if *sw.noIndex {
		o.NoIndex = ptr(true)
	}
	if *sw.verbose {
		o.Verbose = ptr(true)
	}
}

func ptr[T any](value T) *T { return &value }

// loadConfigSub parses the --home/--config flags shared by config subcommands
// and returns the remaining positional args plus the resolved config.
func loadConfigSub(args []string) ([]string, *config.Config, error) {
	fs := flag.NewFlagSet("config", flag.ContinueOnError)
	o := &config.Overrides{}
	fs.StringVar(&o.Home, "home", "", "managed home dir (default ~/.codeberg)")
	fs.StringVar(&o.ConfigFile, "config", "", "config file path (default <home>/config)")

	if err := fs.Parse(args); err != nil {
		return nil, nil, err
	}

	c, err := config.Load(*o)
	if err != nil {
		return nil, nil, err
	}

	return fs.Args(), c, nil
}
