// Command codeberg is the one-shot launcher for the code-search stack. It loads
// config, makes sure the core, daemon, and agent are built (and the embedding
// model downloaded), starts the daemon (which brings up the C indexer), waits
// for it to be healthy, and hands the terminal to the agent TUI.
//
//	codeberg                 boot everything and open the chat TUI
//	codeberg build           (re)build/download the components and model
//	codeberg doctor          check toolchains, binaries, and resolved config
//	codeberg config [init]   print resolved config, or write a template file
//	codeberg version
//
// It is a standalone wrapper: it talks to core/daemon/agent only as
// subprocesses and over HTTP, never as imported code.
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"codeberg.org/codeberg/launcher/internal/bootstrap"
	"codeberg.org/codeberg/launcher/internal/cleanindex"
	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/deps"
	"codeberg.org/codeberg/launcher/internal/registry"
	"codeberg.org/codeberg/launcher/internal/run"
	"codeberg.org/codeberg/launcher/internal/searxng"
	"codeberg.org/codeberg/launcher/internal/uninstall"
)

const version = "0.1.0"

func main() {
	if err := dispatch(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "codeberg: "+err.Error())
		os.Exit(1)
	}
}

func dispatch(args []string) error {
	cmd := "run"
	if len(args) > 0 && !isFlag(args[0]) {
		cmd, args = args[0], args[1:]
	}
	switch cmd {
	case "run":
		return cmdRun(args)
	case "build":
		return cmdBuild(args)
	case "doctor":
		return cmdDoctor(args)
	case "config":
		return cmdConfig(args)
	case "clean-index", "clean":
		return cmdCleanIndex(args)
	case "repos":
		return cmdRepos(args)
	case "uninstall":
		return cmdUninstall(args)
	case "version", "--version", "-v":
		fmt.Println("codeberg " + version)
		return nil
	case "help", "-h", "--help":
		usage(os.Stdout)
		return nil
	default:
		// `codeberg <dir>` runs against that directory, like `--root <dir>`.
		if fi, err := os.Stat(cmd); err == nil && fi.IsDir() {
			return cmdRun(append([]string{"--root", cmd}, args...))
		}
		usage(os.Stderr)
		return fmt.Errorf("unknown command %q", cmd)
	}
}

// parseShared parses args into overrides, wiring the --vector/--no-vector pair.
func parseShared(name string, args []string) (*config.Overrides, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	o := &config.Overrides{}
	fs.StringVar(&o.Root, "root", "", "repository tree to index (CODEBERG_ROOT)")
	fs.StringVar(&o.Repos, "repos", "", "comma-separated dirs or repo keys to serve together (CODEBERG_REPOS)")
	fs.StringVar(&o.Model, "model", "", "LLM as provider:model (CODEBERG_MODEL)")
	fs.StringVar(&o.DaemonURL, "daemon-url", "", "daemon URL the agent queries")
	fs.StringVar(&o.HTTPPort, "port", "", "daemon HTTP port (default 48080)")
	fs.StringVar(&o.EmbedModel, "embed-model", "", "embedding model .onnx path")
	fs.StringVar(&o.IndexPath, "index-path", "", "vector index base path")
	fs.StringVar(&o.Socket, "socket", "", "cberg-index IPC socket path")
	fs.StringVar(&o.Reasoning, "reasoning", "", "reasoning effort (low|medium|high|…)")
	fs.StringVar(&o.Repo, "repo", "", "source checkout to build/run")
	fs.StringVar(&o.Dist, "dist", "", "prebuilt artifact dir to run (CODEBERG_DIST)")
	fs.StringVar(&o.Home, "home", "", "managed home dir (default ~/.codeberg)")
	fs.StringVar(&o.ConfigFile, "config", "", "config file path (default <home>/config)")
	fs.StringVar(&o.WebPort, "web-port", "", "web UI port (default "+config.DefaultWebPort+")")
	noVector := fs.Bool("no-vector", false, "chunk-only mode (skip embedding model)")
	vector := fs.Bool("vector", false, "force vector search on")
	web := fs.Bool("web", false, "serve the browser chat UI instead of the terminal TUI")
	all := fs.Bool("all", false, "search across every previously indexed repo (see `codeberg repos`)")
	noIndex := fs.Bool("no-index", false, "one-off run: register nothing, build no vector index (search off)")
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "Usage: codeberg %s [flags]\n\nFlags:\n", name)
		fs.PrintDefaults()
	}
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if *noVector {
		v := false
		o.Vector = &v
	}
	if *vector {
		v := true
		o.Vector = &v
	}
	if *web {
		v := true
		o.Web = &v
	}
	if *all {
		v := true
		o.All = &v
	}
	if *noIndex {
		v := true
		o.NoIndex = &v
	}
	return o, nil
}

func cmdRun(args []string) error {
	o, err := parseShared("run", args)
	if err != nil {
		return err
	}
	c, err := config.Load(*o)
	if err != nil {
		return err
	}
	// Create a template config on first run so there is an obvious place to edit.
	if created, _ := config.InitFile(c.ConfigPath); created {
		fmt.Fprintf(os.Stderr, "› wrote a starter config at %s\n", c.ConfigPath)
	}
	if c.All && len(c.Repos) > 0 {
		return fmt.Errorf("--all already serves every registered repo; use --repos to pick a subset instead")
	}
	if (c.All || len(c.Repos) > 0) && o.Root != "" {
		return fmt.Errorf("--root names a single repo; drop it when using --all/--repos")
	}
	if err := c.ValidateForRun(); err != nil {
		return err
	}
	switch {
	case c.All:
		entries, err := registry.Load(c.Home)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if fi, statErr := os.Stat(e.Root); statErr != nil || !fi.IsDir() {
				fmt.Fprintf(os.Stderr, "warning: skipping %s — %s no longer exists\n", e.Key, e.Root)
				continue
			}
			c.Roots = append(c.Roots, e)
		}
		if len(c.Roots) == 0 {
			return fmt.Errorf("no repos registered yet — run `codeberg <dir>` (or --root <dir>) first, then `codeberg --all`")
		}
	case len(c.Repos) > 0:
		// A chosen set of dirs and/or registered keys. Dirs are registered like
		// any other run, unless --no-index makes this a leave-no-trace session.
		roots, err := registry.Select(c.Home, c.Repos, !c.NoIndex)
		if err != nil {
			return err
		}
		c.Roots = roots
	case c.NoIndex:
		// One-off single root: resolve it (reusing a registered key if the
		// path happens to be known) without writing to the registry.
		roots, err := registry.Select(c.Home, []string{c.Root}, false)
		if err != nil {
			return err
		}
		c.Roots = roots
	default:
		// Remember this root so `codeberg --all` can search every repo ever indexed.
		e, err := registry.Upsert(c.Home, c.Root)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: could not update the repo registry: %v\n", err)
			e = registry.Entry{Key: filepath.Base(c.Root), Root: c.Root}
		}
		c.Roots = []registry.Entry{e}
	}
	if err := bootstrap.Ensure(c, false); err != nil {
		return err
	}
	return run.Run(c)
}

func cmdBuild(args []string) error {
	o, err := parseShared("build", args)
	if err != nil {
		return err
	}
	c, err := config.Load(*o)
	if err != nil {
		return err
	}
	if _, prebuilt := c.ResolveRoot(); prebuilt {
		fmt.Fprintln(os.Stderr, "running from a prebuilt install — nothing to build; checking the model only")
	} else if c.Repo == "" {
		return fmt.Errorf("no source checkout found; run inside it or pass --repo")
	}
	return bootstrap.Ensure(c, true)
}

func cmdConfig(args []string) error {
	// Optional leading subcommand: codeberg config <sub> [flags] [args].
	sub := ""
	if len(args) > 0 && !isFlag(args[0]) {
		sub, args = args[0], args[1:]
	}
	rest, c, err := loadConfigSub(args)
	if err != nil {
		return err
	}

	switch sub {
	case "": // print resolved config
		fmt.Print(c.Summary())
		return nil

	case "path":
		fmt.Println(c.ConfigPath)
		return nil

	case "init":
		created, err := config.InitFile(c.ConfigPath)
		if err != nil {
			return err
		}
		if created {
			fmt.Printf("wrote %s — set %s and %s, then run `codeberg`\n",
				c.ConfigPath, config.KeyRoot, config.KeyModel)
		} else {
			fmt.Printf("%s already exists (not overwritten)\n", c.ConfigPath)
		}
		return nil

	case "edit":
		if _, err := config.InitFile(c.ConfigPath); err != nil {
			return err
		}
		return openEditor(c.ConfigPath)

	case "get":
		if len(rest) != 1 {
			return fmt.Errorf("usage: codeberg config get KEY")
		}
		v, ok := c.Get(rest[0])
		if !ok {
			return fmt.Errorf("unknown key %q (see `codeberg config` for known keys)", rest[0])
		}
		fmt.Println(v)
		return nil

	case "set":
		if len(rest) == 0 {
			return fmt.Errorf("usage: codeberg config set KEY=VALUE [KEY=VALUE ...]")
		}
		kv := map[string]string{}
		for _, pair := range rest {
			eq := indexOf(pair, '=')
			if eq <= 0 {
				return fmt.Errorf("expected KEY=VALUE, got %q", pair)
			}
			key, val := pair[:eq], pair[eq+1:]
			if !config.IsKnownKey(key) {
				fmt.Fprintf(os.Stderr, "warning: %q is not a key codeberg reads (writing it anyway)\n", key)
			}
			kv[key] = val
		}
		if err := config.SetValues(c.ConfigPath, kv); err != nil {
			return err
		}
		fmt.Printf("updated %s (%d key(s)); applies on the next `codeberg` run\n", c.ConfigPath, len(kv))
		return nil

	case "unset":
		if len(rest) == 0 {
			return fmt.Errorf("usage: codeberg config unset KEY [KEY ...]")
		}
		if err := config.UnsetValues(c.ConfigPath, rest); err != nil {
			return err
		}
		fmt.Printf("removed %d key(s) from %s\n", len(rest), c.ConfigPath)
		return nil

	default:
		return fmt.Errorf("unknown config subcommand %q (try: path, init, edit, get, set, unset)", sub)
	}
}

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

// openEditor opens path in $VISUAL/$EDITOR (falling back to vi), inheriting the
// terminal so the user can edit interactively.
func openEditor(path string) error {
	ed := firstNonEmpty(os.Getenv("VISUAL"), os.Getenv("EDITOR"), "vi")
	parts := strings.Fields(ed) // allow e.g. EDITOR="code -w"
	parts = append(parts, path)
	cmd := exec.Command(parts[0], parts[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func indexOf(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

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
		if fi, err := os.Stat(e.Root); err != nil || !fi.IsDir() {
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

func cmdDoctor(args []string) error {
	o, err := parseShared("doctor", args)
	if err != nil {
		return err
	}
	c, err := config.Load(*o)
	if err != nil {
		return err
	}

	fmt.Println("Toolchains:")
	for _, t := range []string{"go", "node", "npm", "make", "cmake", "git"} {
		if p, err := exec.LookPath(t); err == nil {
			fmt.Printf("  ✓ %-12s %s\n", t, p)
		} else {
			fmt.Printf("  ✘ %-12s not found — `codeberg build` auto-installs it (brew/apt)\n", t)
		}
	}
	// The ONNX runtime is a library, not a binary on PATH — check the way the
	// core's CMake does, since it's what enables vector embeddings.
	if deps.OnnxPresent() {
		fmt.Printf("  ✓ %-12s installed (vector embeddings available)\n", "onnxruntime")
	} else {
		fmt.Printf("  ✘ %-12s not found — needed for vector mode; `codeberg build` installs it on macOS\n", "onnxruntime")
	}

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
		a := config.LocateArtifacts(root)
		reportFile("cberg-index (core)", a.IndexBin)
		reportFile("codeberg-d (daemon)", a.DaemonBin)
		reportFile("agent TUI", a.TUIScript)
		reportFile("agent web UI (--web)", a.WebScript)
	}
	if c.Vector {
		reportFile("embedding model", c.EmbedModel)
	}

	fmt.Println("\nWeb search (web_search):")
	switch {
	case !c.WebUse:
		fmt.Println("  • disabled (CODEBERG_WEB_USE=false) — fetch_url also off")
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

	fmt.Println("\nResolved config:")
	fmt.Print(c.Summary())
	return nil
}

func reportFile(label, path string) {
	if _, err := os.Stat(path); err == nil {
		fmt.Printf("  ✓ %-22s %s\n", label, path)
	} else {
		fmt.Printf("  ✘ %-22s missing (%s) — run `codeberg build`\n", label, path)
	}
}

func isFlag(s string) bool { return len(s) > 0 && s[0] == '-' }

func usage(w *os.File) {
	fmt.Fprint(w, `codeberg — launch the code-search stack (core + daemon + agent TUI)

One command builds anything missing, starts the daemon (which brings up the C
indexer), waits for it to be healthy, and opens the agent chat — like claude.

USAGE
  codeberg [flags]               boot everything and open the chat TUI
  codeberg <dir>                 index/search that directory (same as --root <dir>)
  codeberg --all [flags]         search every previously indexed repo combined
  codeberg --repos a,b [flags]   serve a chosen set of dirs and/or repo keys
  codeberg --no-index [flags]    one-off run: register nothing, build no index
  codeberg --web [flags]         …or open the chat in a browser instead of the TUI
  codeberg build [flags]         (re)build/download components and the model
  codeberg doctor                check toolchains, binaries, and resolved config
  codeberg config [sub]          view/change configuration (see below)
  codeberg repos                 list registered repos (what --all will search)
  codeberg clean-index [--dry-run]  prune cached per-directory vector indexes
  codeberg uninstall             remove the command; ask before deleting data
  codeberg version
  codeberg help                  show this help

CONFIGURE (changeable any time after install)
  codeberg config                print the resolved config (secrets masked)
  codeberg config path           print the config file path
  codeberg config get KEY        print one resolved value
  codeberg config set KEY=VALUE  set one or more values (KEY=VALUE ...)
  codeberg config unset KEY      remove a value
  codeberg config edit           open the config file in $EDITOR
  codeberg config init           write a starter config file

  Config is read fresh on every run from four layers, highest precedence first:
    1. CLI flags        e.g. codeberg --root ~/proj --model openai:gpt-4o
    2. environment      e.g. CODEBERG_MODEL=… ANTHROPIC_API_KEY=…
    3. ~/.codeberg/config   (KEY=VALUE; written by config set / edit / init)
    4. built-in defaults
  Changes take effect the next time you run codeberg (it restarts the daemon
  each session, so a new root or model is picked up automatically).

COMMON TASKS
  First run:        codeberg config set CODEBERG_ROOT=~/proj \
                      CODEBERG_MODEL=anthropic:claude-haiku-4-5 \
                      ANTHROPIC_API_KEY=sk-ant-… ; codeberg
  Switch model:     codeberg config set CODEBERG_MODEL=openai:gpt-4o ; codeberg
  Index another repo: codeberg ~/other                   (registers it too)
  Search all repos: codeberg --all      (everything ever indexed; see: codeberg repos)
  A chosen subset:  codeberg --repos ~/proj-a,api        (dirs and/or repo keys)
  Leave no trace:   codeberg ~/scratch --no-index        (not registered, no index)
  No embeddings:    codeberg config set CODEBERG_VECTOR=false ; codeberg
  What's installed: codeberg doctor

KEY SETTINGS
  CODEBERG_ROOT     repository to index            (--root)
  CODEBERG_ALL      true = search all registered repos (--all)
  CODEBERG_REPOS    comma-separated dirs/keys to serve (--repos)
  CODEBERG_NO_INDEX true = register nothing, no index  (--no-index)
  CODEBERG_MODEL    LLM as provider:model          (--model)
  CODEBERG_VECTOR   false = chunk-only, skip model (--no-vector)
  CODEBERG_HTTP_PORT  daemon port (default 48080)  (--port)
  CODEBERG_WEB      true = open the browser UI      (--web)
  CODEBERG_WEB_PORT   browser UI port (default 48088)  (--web-port)
  CODEBERG_REASONING  reasoning effort             (--reasoning)
  ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY

Note: there is no in-chat /help or /config — the chat UI is a third-party TUI
with no slash commands. Configure from this CLI (above) instead.
`)
}
