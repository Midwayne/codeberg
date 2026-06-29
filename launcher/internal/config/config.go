// Package config resolves the launcher's unified configuration from four
// layers, lowest precedence first: built-in defaults, the ~/.codeberg/config
// file, the process environment, and CLI flags. The result is split back into
// the two scopes the components actually read: daemon-scope env (consumed by
// codeberg-d, which forwards the relevant bits to the C cberg-index) and
// agent-scope env (consumed by the Node TUI).
//
// Neither codeberg-d nor the agent read a .env file themselves — they read
// os.Getenv / process.env — so the launcher is the single place that loads
// config and injects it into each child process.
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"codeberg.org/codeberg/launcher/internal/paths"
)

// Canonical keys. These match the env var names the components already read,
// so a value works whether it is set in the config file, the environment, or
// (via the matching flag) on the command line.
const (
	KeyRoot       = "CODEBERG_ROOT"                  // repo to index (daemon scope)
	KeyModel      = "CODEBERG_MODEL"                 // LLM provider:model (agent scope)
	KeyDaemonURL  = "CODEBERG_DAEMON_URL"            // agent -> daemon (agent scope)
	KeyHTTPPort   = "CODEBERG_HTTP_PORT"             // daemon listen port (daemon scope)
	KeyEmbedModel = "CBERG_MODEL"                    // embedding model path (daemon scope)
	KeyIndexPath  = "CBERG_INDEX_PATH"               // vector index base path (daemon scope)
	KeySocket     = "CBERG_SOCKET"                   // cberg-index IPC socket (daemon scope)
	KeyPollMS     = "CBERG_POLL_MS"                  // watcher poll ms (daemon scope)
	KeyIndexBin   = "CBERG_INDEX_BIN"                // override cberg-index path (daemon scope)
	KeyGitPullSec = "CODEBERG_GIT_PULL_INTERVAL_SEC" // periodic git pull (daemon scope)
	KeyGitDir     = "CODEBERG_GIT_DIR"               // git dir for pull (daemon scope)
	KeyReasoning  = "CODEBERG_REASONING"             // reasoning effort (agent scope)
	KeyVector     = "CODEBERG_VECTOR"                // "false" => chunk-only mode
	KeyHome       = "CODEBERG_HOME"                  // launcher managed dir
	KeyRepo       = "CODEBERG_REPO"                  // source checkout to build/run
	KeyDist       = "CODEBERG_DIST"                  // prebuilt artifact dir (installs)
	KeyWeb        = "CODEBERG_WEB"                   // "true" => serve browser UI not TUI
	KeyWebPort    = "CODEBERG_WEB_PORT"              // web UI listen port (agent scope)
)

// DefaultWebPort is the codeberg-web listen port when none is configured. It
// mirrors the agent's own default (agent/src/web/main.ts): an uncommon high
// port — not the much-contended 3000 — sitting just past the daemon's 48080 so
// codeberg's two ports group together, and below the 49152+ ephemeral range.
const DefaultWebPort = "48088"

// BuildDist is an optional compile-time default for the prebuilt artifact
// directory, injected by packagers via the linker:
//
//	go build -ldflags "-X codeberg.org/codeberg/launcher/internal/config.BuildDist=/opt/homebrew/.../libexec"
//
// A Homebrew/release build points it at the install prefix's payload so the
// installed `codeberg` runs without a source checkout or any build toolchain.
// Empty in a plain `go build` — the launcher then builds from the source tree.
var BuildDist string

// passthroughKeys are provider secrets/endpoints copied straight through to the
// agent when present (in the config file or the environment). The daemon never
// sees these — it has no LLM key.
var passthroughKeys = []string{
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_GENERATIVE_AI_API_KEY",
	"OLLAMA_BASE_URL",
	"LLAMACPP_BASE_URL",
}

// Overrides carries values from the command line. Empty string means "not set
// on the CLI" and the lower layers decide. Vector is a tri-state via pointer.
type Overrides struct {
	Repo       string
	Dist       string
	Home       string
	ConfigFile string // explicit config path; "" => <home>/config

	Root       string
	Model      string
	DaemonURL  string
	HTTPPort   string
	EmbedModel string
	IndexPath  string
	Socket     string
	Reasoning  string
	Vector     *bool
	Web        *bool // serve the browser UI instead of the terminal TUI
	WebPort    string
}

// Config is the fully-resolved configuration.
type Config struct {
	Repo string // source checkout to build from ("" when running prebuilt)
	Dist string // prebuilt artifact dir ("" when building from source)
	Home string

	Root       string
	Model      string
	DaemonURL  string
	HTTPPort   string
	EmbedModel string
	IndexPath  string
	Socket     string
	PollMS     string
	IndexBin   string
	GitPullSec string
	GitDir     string
	Reasoning  string
	Vector     bool
	Web        bool   // serve the browser UI instead of the terminal TUI
	WebPort    string // codeberg-web listen port (used only when Web)

	Passthrough map[string]string
	ConfigPath  string // the file we read (whether or not it existed)
}

// Load resolves config across all four layers.
func Load(o Overrides) (*Config, error) {
	home := paths.Home(o.Home)

	configPath := o.ConfigFile
	if configPath == "" {
		configPath = paths.ConfigFile(home)
	}
	fileVals, err := parseFile(configPath)
	if err != nil {
		return nil, err
	}

	// Repo (the source checkout) resolves like every other key: --repo flag,
	// then CODEBERG_REPO in the environment, then in the config file; otherwise
	// it is discovered by walking up from the cwd or the (symlink-resolved)
	// binary location.
	repo := paths.FindRepo(firstNonEmpty(o.Repo, os.Getenv(KeyRepo), fileVals[KeyRepo]))

	// Dist (a prebuilt artifact dir, as installed by Homebrew/a release tarball)
	// follows the same CLI > env > file precedence, then a compile-time BuildDist
	// a packager baked in, then autodetection relative to the launcher binary
	// (the `<bin>/codeberg` + `<bin>/../libexec` install layout). When it resolves
	// to a populated dir the launcher runs from it and skips building; otherwise
	// it's "" and we build from the source checkout above.
	dist := firstNonEmpty(o.Dist, os.Getenv(KeyDist), fileVals[KeyDist], BuildDist, autodetectDist())

	// resolve(key, cliValue) applies precedence: CLI > env > file.
	// (Defaults are applied per-field below, after this.)
	resolve := func(key, cli string) string {
		if cli != "" {
			return cli
		}
		if v, ok := os.LookupEnv(key); ok && v != "" {
			return v
		}
		return fileVals[key]
	}

	c := &Config{
		Home:        home,
		Repo:        repo,
		Dist:        abs(dist),
		ConfigPath:  configPath,
		Passthrough: map[string]string{},
	}

	c.Root = resolve(KeyRoot, o.Root)
	c.Model = resolve(KeyModel, o.Model)
	// Default off the crowded 8080 (used by countless dev servers) to an
	// uncommon high port, kept below the 49152+ ephemeral range so the OS does
	// not hand it out to transient clients.
	c.HTTPPort = firstNonEmpty(resolve(KeyHTTPPort, o.HTTPPort), "48080")
	c.Socket = firstNonEmpty(resolve(KeySocket, o.Socket), "/tmp/codeberg-index.sock")
	c.PollMS = resolve(KeyPollMS, "")
	c.IndexBin = resolve(KeyIndexBin, "")
	c.GitPullSec = resolve(KeyGitPullSec, "")
	c.GitDir = resolve(KeyGitDir, "")
	c.Reasoning = resolve(KeyReasoning, o.Reasoning)

	// Vector: CLI flag wins; else env/file "false"/"0" disables; default on.
	c.Vector = true
	if o.Vector != nil {
		c.Vector = *o.Vector
	} else if v := resolve(KeyVector, ""); v != "" {
		c.Vector = !isFalsey(v)
	}

	// Web: serve the browser UI instead of the TUI. Default off; --web (or
	// CODEBERG_WEB=true) turns it on. The CLI flag, when passed, wins.
	c.Web = false
	if o.Web != nil {
		c.Web = *o.Web
	} else if v := resolve(KeyWeb, ""); v != "" {
		c.Web = !isFalsey(v)
	}
	c.WebPort = firstNonEmpty(resolve(KeyWebPort, o.WebPort), DefaultWebPort)

	// Daemon URL defaults to the local daemon on the resolved port.
	c.DaemonURL = firstNonEmpty(resolve(KeyDaemonURL, o.DaemonURL), "http://127.0.0.1:"+c.HTTPPort)

	// Embedding model: default under the managed home (not the repo) so it is
	// downloaded once and reused across repo moves/re-clones and checkouts.
	// Stored absolute so the daemon resolves it regardless of cwd.
	embed := resolve(KeyEmbedModel, o.EmbedModel)
	if embed == "" {
		embed = filepath.Join(home, "models", "jina-embeddings-v2-base-code", "model.onnx")
	}
	c.EmbedModel = abs(embed)

	// Vector index lives under the managed home so it survives repo rebuilds.
	idx := resolve(KeyIndexPath, o.IndexPath)
	if idx == "" {
		idx = filepath.Join(home, "index", "codeberg.usearch")
	}
	c.IndexPath = abs(idx)

	for _, k := range passthroughKeys {
		if v, ok := os.LookupEnv(k); ok && v != "" {
			c.Passthrough[k] = v
		} else if v := fileVals[k]; v != "" {
			c.Passthrough[k] = v
		}
	}

	return c, nil
}

// Artifacts are the on-disk products the launcher runs, under some root — a
// source checkout's build tree or an installed dist dir laid out the same way.
type Artifacts struct {
	DaemonBin string // <root>/core/build/bin/codeberg-d
	IndexBin  string // <root>/core/build/bin/cberg-index (daemon finds it as a sibling)
	TUIScript string // <root>/agent/dist/tui.js (node resolves node_modules up from it)
	WebScript string // <root>/agent/dist/web.js (the browser-UI server; built alongside the TUI)
}

// LocateArtifacts returns the expected artifact paths under root (no existence
// check). The dist layout deliberately mirrors these subpaths so an installed
// tree and a source checkout are interchangeable here.
func LocateArtifacts(root string) Artifacts {
	bin := filepath.Join(root, "core", "build", "bin")
	return Artifacts{
		DaemonBin: filepath.Join(bin, "codeberg-d"),
		IndexBin:  filepath.Join(bin, "cberg-index"),
		TUIScript: filepath.Join(root, "agent", "dist", "tui.js"),
		WebScript: filepath.Join(root, "agent", "dist", "web.js"),
	}
}

// autodetectDist finds a prebuilt payload installed alongside the launcher
// binary, so a relocatable package works wherever it lands without a baked-in
// path. The install layout is `<root>/bin/codeberg` next to
// `<root>/libexec/<payload>`, so from the resolved binary the payload is at
// `../libexec`. Returns "" unless that dir actually holds the artifacts — so a
// plain `go build` of the launcher (no sibling libexec) falls through to source.
func autodetectDist() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r // installed as a symlink onto PATH -> resolve to the real binary
	}
	cand := filepath.Clean(filepath.Join(filepath.Dir(exe), "..", "libexec"))
	a := LocateArtifacts(cand)
	if fileExists(a.DaemonBin) && fileExists(a.IndexBin) && fileExists(a.TUIScript) {
		return cand
	}
	return ""
}

// ResolveRoot picks the directory the launcher locates binaries and the agent
// under, and reports whether it is a prebuilt install (so no build is needed).
// A populated Dist wins — its three artifacts must all exist — otherwise we fall
// back to the source checkout (Repo), which may itself be "" if none was found.
func (c *Config) ResolveRoot() (root string, prebuilt bool) {
	if c.Dist != "" {
		a := LocateArtifacts(c.Dist)
		if fileExists(a.DaemonBin) && fileExists(a.IndexBin) && fileExists(a.TUIScript) {
			return c.Dist, true
		}
	}
	return c.Repo, false
}

// ValidateForRun checks the fields required to actually launch.
func (c *Config) ValidateForRun() error {
	var missing []string
	if root, _ := c.ResolveRoot(); root == "" {
		return fmt.Errorf("could not locate codeberg's components — neither a prebuilt install (%s) nor a source checkout with core/, daemon/ and agent/ (%s).\n"+
			"Note this is about the launcher's OWN files, NOT %s (the repo you want to index).\n"+
			"Install via Homebrew, or run codeberg from inside a checkout / set it: codeberg config set %s=/path/to/codeberg  (or pass --repo).",
			KeyDist, KeyRepo, KeyRoot, KeyRepo)
	}
	if c.Root == "" {
		missing = append(missing, KeyRoot+" (the repository to index)")
	} else if fi, err := os.Stat(c.Root); err != nil || !fi.IsDir() {
		return fmt.Errorf("%s is not a directory: %s", KeyRoot, c.Root)
	}
	if c.Model == "" {
		missing = append(missing, KeyModel+" (provider:model, e.g. anthropic:claude-haiku-4-5)")
	} else if !strings.Contains(c.Model, ":") {
		return fmt.Errorf("%s must be provider:model, got %q", KeyModel, c.Model)
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required config:\n  - %s\nset them in %s, via flags, or the environment (try `codeberg config init`)",
			strings.Join(missing, "\n  - "), c.ConfigPath)
	}
	return nil
}

// DaemonEnv builds the environment overlay for codeberg-d. The daemon forwards
// CODEBERG_ROOT/CBERG_* to the C cberg-index when it spawns it.
func (c *Config) DaemonEnv() map[string]string {
	e := map[string]string{
		KeyRoot:     c.Root,
		KeyHTTPPort: c.HTTPPort,
		KeySocket:   c.Socket,
	}
	if c.Vector {
		e[KeyEmbedModel] = c.EmbedModel
		e[KeyIndexPath] = c.IndexPath
	}
	putIf(e, KeyPollMS, c.PollMS)
	putIf(e, KeyIndexBin, c.IndexBin)
	putIf(e, KeyGitPullSec, c.GitPullSec)
	putIf(e, KeyGitDir, c.GitDir)
	return e
}

// AgentEnv builds the environment overlay for the Node TUI.
func (c *Config) AgentEnv() map[string]string {
	e := map[string]string{
		KeyModel:     c.Model,
		KeyDaemonURL: c.DaemonURL,
	}
	putIf(e, KeyReasoning, c.Reasoning)
	// codeberg-web reads this; the TUI ignores it, so it's harmless to always set.
	putIf(e, KeyWebPort, c.WebPort)
	for k, v := range c.Passthrough {
		e[k] = v
	}
	return e
}

func putIf(m map[string]string, k, v string) {
	if v != "" {
		m[k] = v
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func isFalsey(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "false", "0", "no", "off":
		return true
	}
	return false
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func abs(p string) string {
	if p == "" {
		return ""
	}
	if a, err := filepath.Abs(p); err == nil {
		return a
	}
	return p
}

// parseFile reads a KEY=VALUE file (shell-style; `#` comments, optional quotes,
// optional `export `). A missing file is not an error — lower layers apply.
func parseFile(path string) (map[string]string, error) {
	vals := map[string]string{}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return vals, nil
		}
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		val = strings.Trim(val, `"'`)
		if key != "" {
			vals[key] = val
		}
	}
	return vals, sc.Err()
}
