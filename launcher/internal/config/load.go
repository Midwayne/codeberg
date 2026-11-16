package config

import (
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/embedding"
	"codeberg.org/codeberg/launcher/internal/paths"
)

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
	from := layers{file: fileVals}

	c := &Config{
		Home:        home,
		ConfigPath:  configPath,
		Passthrough: map[string]string{},
	}

	c.loadInstall(from, o)
	c.loadServices(from, o)
	c.loadRunMode(from, o)
	c.loadTools(from)

	if err := c.loadEmbedding(from, o); err != nil {
		return nil, err
	}

	for _, key := range passthroughKeys {
		if v := from.value(key, ""); v != "" {
			c.Passthrough[key] = v
		}
	}

	return c, nil
}

// loadInstall locates codeberg's own files: a source checkout or a prebuilt
// install.
func (c *Config) loadInstall(from layers, o Overrides) {
	// Repo (the source checkout) is otherwise discovered by walking up from
	// the cwd or the (symlink-resolved) binary location.
	c.Repo = paths.FindRepo(from.value(KeyRepo, o.Repo))

	// Dist (a prebuilt artifact dir, as installed by Homebrew/a release
	// tarball) falls back to a compile-time BuildDist a packager baked in,
	// then autodetection relative to the launcher binary (the `<bin>/codeberg`
	// + `<bin>/../libexec` install layout). When it resolves to a populated
	// dir the launcher runs from it and skips building; otherwise it's "" and
	// we build from the source checkout above.
	c.Dist = abs(firstNonEmpty(from.value(KeyDist, o.Dist), BuildDist, autodetectDist()))
}

// loadServices resolves the models, ports, and paths the daemon and agent
// are started with.
func (c *Config) loadServices(from layers, o Overrides) {
	c.Root = o.Root
	c.Model = from.value(KeyModel, o.Model)
	c.SubagentModel = from.value(KeySubagentModel, o.SubagentModel)
	c.Reasoning = from.value(KeyReasoning, o.Reasoning)

	// Default off the crowded 8080 (used by countless dev servers) to an
	// uncommon high port, kept below the 49152+ ephemeral range so the OS does
	// not hand it out to transient clients.
	c.HTTPPort = from.valueOr(KeyHTTPPort, o.HTTPPort, "48080")
	c.WebPort = from.valueOr(KeyWebPort, o.WebPort, DefaultWebPort)
	c.DaemonURL = from.valueOr(KeyDaemonURL, o.DaemonURL, "http://127.0.0.1:"+c.HTTPPort)

	c.Socket = from.valueOr(KeySocket, o.Socket, "/tmp/codeberg-index.sock")
	c.PollMS = from.value(KeyPollMS, "")
	c.IndexBin = from.value(KeyIndexBin, "")
	c.GitPullSec = from.value(KeyGitPullSec, "")
	c.GitDir = from.value(KeyGitDir, "")
}

// loadRunMode resolves which repos are served and how.
func (c *Config) loadRunMode(from layers, o Overrides) {
	// Vector search is on unless disabled.
	c.Vector = from.enabled(KeyVector, o.Vector, true)

	// All: serve every registered repo combined instead of a single root.
	// An explicit --root cannot combine with registry selection.
	c.All = from.enabled(KeyAll, o.All, false)

	// Repos: an explicit set of dirs/keys to serve together — --all scoped to
	// a chosen few. Resolved against the registry in cmdRun.
	c.Repos = splitList(from.value(KeyReposSel, o.Repos))

	// NoIndex: a one-off session. Nothing is added to the repo registry and no
	// vector index is built or reused — which means semantic search is off for
	// the run (file tools and chat still work), and nothing lands on disk.
	c.NoIndex = from.enabled(KeyNoIndex, o.NoIndex, false)
	if c.NoIndex {
		c.Vector = false
	}

	// Verbose: mirror component checks and daemon/indexer logs during startup.
	// Off by default; the terminal shows the version, a spinner and the URL.
	c.Verbose = from.enabled(KeyVerbose, o.Verbose, false)
}

// loadTools resolves the agent's optional tool families. None has a flag.
func (c *Config) loadTools(from layers) {
	// Direct URL fetching is on by default; search requires a separate opt-in.
	// The master switch disables both. A browser preference overrides the
	// initial search opt-in and controls the managed service on demand.
	c.WebUse = from.enabled(KeyWebUse, nil, true)
	c.WebSearchUse = from.enabled(KeyWebSearchUse, nil, false)
	c.SearxngURL = from.value(KeySearxngURL, "")
	c.SearxngPort = from.valueOr(KeySearxngPort, "", DefaultSearxngPort)

	c.LearningUse = from.enabled(KeyLearningUse, nil, true)

	// MCP tools from Cursor-compatible mcp.json files. Extra config paths
	// (beyond ~/.codeberg/mcp.json and per-repo .codeberg/.cursor files) go in
	// CODEBERG_MCP_CONFIG.
	c.McpUse = from.enabled(KeyMcpUse, nil, true)
	c.McpConfig = from.value(KeyMcpConfig, "")

	// Built-in database MCP (multi-db-mcp-server submodule). Off until the user
	// opts in. The spec lives in the codeberg config directory (spec.yml).
	c.DbmcpUse = from.enabled(KeyDbmcpUse, nil, false)
	c.DbmcpSpec = from.value(KeyDbmcpSpec, "")
	c.DbmcpBin = from.value(KeyDbmcpBin, "")
}

// loadEmbedding resolves the embedding model and the vector index built from
// it. Both default under the managed home (not the repo) so the model is
// downloaded once and the index survives repo moves, re-clones, and rebuilds.
// Paths are stored absolute so the daemon resolves them regardless of cwd.
func (c *Config) loadEmbedding(from layers, o Overrides) error {
	c.Embedding = from.value(KeyEmbedding, o.Embedding)
	if !c.Vector {
		c.Embedding = ""
	}

	modelPath := from.value(KeyEmbedModel, o.EmbedModel)
	indexPath := from.value(KeyIndexPath, o.IndexPath)

	// No registry model: a custom or legacy ONNX path.
	if c.Embedding == "" {
		c.EmbedBackend = "onnx"
		c.EmbedModel = abs(firstNonEmpty(modelPath, filepath.Join(c.Home, "models", "jina-embeddings-v2-base-code", "model.onnx")))
		c.IndexPath = abs(firstNonEmpty(indexPath, filepath.Join(c.Home, "index", "codeberg.usearch")))
		return nil
	}

	model, err := embedding.Lookup(c.Embedding)
	if err != nil {
		return err
	}
	if err := model.ValidatePlatform(); err != nil {
		return err
	}

	switch {
	case indexPath == "":
		indexPath = model.IndexPath(c.Home)
	case c.Embedding != embedding.Jina:
		// An explicit base may contain the legacy ONNX vectors; never reuse it.
		indexPath += "." + c.Embedding
	}

	c.EmbedBackend = model.Backend
	c.EmbedModel = abs(firstNonEmpty(modelPath, model.Path(c.Home)))
	c.IndexPath = abs(indexPath)
	return nil
}
