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
	KeyRoot       = "CODEBERG_ROOT"                   // repo to index (daemon scope)
	KeyModel      = "CODEBERG_MODEL"                  // LLM provider:model (agent scope)
	KeyDaemonURL  = "CODEBERG_DAEMON_URL"             // agent -> daemon (agent scope)
	KeyHTTPPort   = "CODEBERG_HTTP_PORT"              // daemon listen port (daemon scope)
	KeyEmbedModel = "CBERG_MODEL"                     // embedding model path (daemon scope)
	KeyIndexPath  = "CBERG_INDEX_PATH"                // vector index base path (daemon scope)
	KeySocket     = "CBERG_SOCKET"                    // cberg-index IPC socket (daemon scope)
	KeyPollMS     = "CBERG_POLL_MS"                   // watcher poll ms (daemon scope)
	KeyIndexBin   = "CBERG_INDEX_BIN"                 // override cberg-index path (daemon scope)
	KeyGitPullSec = "CODEBERG_GIT_PULL_INTERVAL_SEC"  // periodic git pull (daemon scope)
	KeyGitDir     = "CODEBERG_GIT_DIR"                // git dir for pull (daemon scope)
	KeyReasoning  = "CODEBERG_REASONING"             // reasoning effort (agent scope)
	KeyVector     = "CODEBERG_VECTOR"                 // "false" => chunk-only mode
	KeyHome       = "CODEBERG_HOME"                   // launcher managed dir
	KeyRepo       = "CODEBERG_REPO"                   // source checkout to build/run
)

// passthroughKeys are provider secrets/endpoints copied straight through to the
// agent when present (in the config file or the environment). The daemon never
// sees these — it has no LLM key.
var passthroughKeys = []string{
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_GENERATIVE_AI_API_KEY",
	"OLLAMA_BASE_URL",
}

// Overrides carries values from the command line. Empty string means "not set
// on the CLI" and the lower layers decide. Vector is a tri-state via pointer.
type Overrides struct {
	Repo       string
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
}

// Config is the fully-resolved configuration.
type Config struct {
	Repo string
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

// ValidateForRun checks the fields required to actually launch.
func (c *Config) ValidateForRun() error {
	var missing []string
	if c.Repo == "" {
		return fmt.Errorf("could not locate the codeberg source checkout — the tree with core/, daemon/ and agent/ that the launcher builds and runs.\n"+
			"This is %s (the launcher's own source), NOT %s (the repo you want to index).\n"+
			"Run codeberg from inside the checkout, or set it: codeberg config set %s=/path/to/codeberg  (or pass --repo).",
			KeyRepo, KeyRoot, KeyRepo)
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
