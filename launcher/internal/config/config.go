// Package config resolves the launcher's unified configuration from four
// layers, lowest precedence first: built-in defaults, the ~/.codeberg/config
// file, the process environment, and CLI flags. The result is split back into
// the two scopes the components actually read: daemon-scope env (consumed by
// codeberg-d, which forwards the relevant bits to the C cberg-index) and
// agent-scope env (consumed by the Node agent).
//
// Neither codeberg-d nor the agent read a .env file themselves — they read
// os.Getenv / process.env — so the launcher is the single place that loads
// config and injects it into each child process.
package config

import "codeberg.org/codeberg/launcher/internal/registry"

// Canonical keys. These match the env var names the components already read,
// so a value works whether it is set in the config file, the environment, or
// (via the matching flag) on the command line.
const (
	KeyRoots         = "CODEBERG_ROOTS"                 // key\tpath records of every served repo (daemon scope)
	KeyAll           = "CODEBERG_ALL"                   // "true" => serve every registered repo
	KeyReposSel      = "CODEBERG_REPOS"                 // comma-separated dirs/keys to serve together
	KeyNoIndex       = "CODEBERG_NO_INDEX"              // "true" => register nothing, build no vector index
	KeyVerbose       = "CODEBERG_VERBOSE"               // "true" => detailed startup output instead of a spinner
	KeyModel         = "CODEBERG_MODEL"                 // LLM provider:model (agent scope)
	KeySubagentModel = "CODEBERG_SUBAGENT_MODEL"        // background/subagent provider:model (agent scope)
	KeyLearningUse   = "CODEBERG_LEARNING_USE"          // "false" => disable learning, feedback, and background extraction
	KeyDaemonURL     = "CODEBERG_DAEMON_URL"            // agent -> daemon (agent scope)
	KeyHTTPPort      = "CODEBERG_HTTP_PORT"             // daemon listen port (daemon scope)
	KeyEmbedModel    = "CBERG_MODEL"                    // embedding model path (daemon scope)
	KeyEmbedding     = "CODEBERG_EMBEDDING_MODEL"       // registry selection (launcher scope)
	KeyEmbedBackend  = "CBERG_EMBED_BACKEND"            // ONNX or external worker (daemon scope)
	KeyIndexPath     = "CBERG_INDEX_PATH"               // vector index base path (daemon scope)
	KeySocket        = "CBERG_SOCKET"                   // cberg-index IPC socket (daemon scope)
	KeyPollMS        = "CBERG_POLL_MS"                  // watcher poll ms (daemon scope)
	KeyIndexBin      = "CBERG_INDEX_BIN"                // override cberg-index path (daemon scope)
	KeyGitPullSec    = "CODEBERG_GIT_PULL_INTERVAL_SEC" // periodic git pull (daemon scope)
	KeyGitDir        = "CODEBERG_GIT_DIR"               // git dir for pull (daemon scope)
	KeyReasoning     = "CODEBERG_REASONING"             // reasoning effort (agent scope)
	KeyVector        = "CODEBERG_VECTOR"                // "false" => chunk-only mode
	KeyHome          = "CODEBERG_HOME"                  // launcher managed dir
	KeyLogDir        = "CODEBERG_LOG_DIR"               // daemon/indexer log directory
	KeyRepo          = "CODEBERG_REPO"                  // source checkout to build/run
	KeyDist          = "CODEBERG_DIST"                  // prebuilt artifact dir (installs)
	KeyWebPort       = "CODEBERG_WEB_PORT"              // web UI listen port (agent scope)
	KeyWebUse        = "CODEBERG_WEB_USE"               // "false" => disable agent web tools (agent scope)
	KeyWebSearchUse  = "CODEBERG_WEB_SEARCH_USE"        // opt into web search (default off)
	KeySearxngURL    = "CODEBERG_SEARXNG_URL"           // external SearXNG for web_search (agent scope)
	KeySearxngPort   = "CODEBERG_SEARXNG_PORT"          // preferred port for the managed SearXNG
	KeyMcpUse        = "CODEBERG_MCP_USE"               // "false" => disable MCP tools (agent scope)
	KeyMcpConfig     = "CODEBERG_MCP_CONFIG"            // extra mcp.json path(s), comma-separated (agent scope)
	KeyDbmcpUse      = "CODEBERG_DBMCP_USE"             // "true" => built-in multi-db MCP (agent scope)
	KeyDbmcpSpec     = "CODEBERG_DBMCP_SPEC"            // spec.yml path; default <home>/spec.yml (agent scope)
	KeyDbmcpBin      = "CODEBERG_DBMCP_BIN"             // dbmcp binary override (agent scope)
	KeyScriptUse     = "CODEBERG_SCRIPT_USE"            // "true" => run_script tool (agent scope)
	KeyScriptPython  = "CODEBERG_SCRIPT_PYTHON"         // run_script interpreter override (agent scope)
)

// DefaultSearxngPort is the preferred listen port for the launcher-managed
// SearXNG (web_search backend). It groups with codeberg's other ports — the
// daemon's 48080 and the web UI's 48088 — and the launcher falls back to a free
// ephemeral port if it is taken.
const DefaultSearxngPort = "48089"

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
	"TYPESAFE_API_KEY",
	"OPENROUTER_API_KEY",
	"CLOUDFLARE_API_TOKEN",
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

	Root          string
	Repos         string // comma-separated dirs/keys to serve together (--repos)
	Model         string
	SubagentModel string
	DaemonURL     string
	HTTPPort      string
	EmbedModel    string
	Embedding     string
	IndexPath     string
	Socket        string
	Reasoning     string
	Vector        *bool
	All           *bool // serve every registered repo instead of one root
	NoIndex       *bool // one-off run: register nothing, build no vector index
	Verbose       *bool // detailed startup output (--verbose)
	WebPort       string
}

// Config is the fully-resolved configuration.
type Config struct {
	Repo string // source checkout to build from ("" when running prebuilt)
	Dist string // prebuilt artifact dir ("" when building from source)
	Home string

	Root          string
	All           bool             // serve every registered repo (--all)
	Repos         []string         // explicit dirs/keys to serve together (--repos)
	NoIndex       bool             // one-off run: register nothing, build no vector index
	Verbose       bool             // detailed startup output instead of a spinner
	Roots         []registry.Entry // the repos this run serves; filled by cmdRun
	Model         string
	SubagentModel string
	DaemonURL     string
	HTTPPort      string
	EmbedModel    string
	Embedding     string // registry model id, empty for a custom ONNX path
	EmbedBackend  string
	IndexPath     string
	Socket        string
	PollMS        string
	IndexBin      string
	GitPullSec    string
	GitDir        string
	Reasoning     string
	Vector        bool
	WebPort       string // codeberg-web listen port
	WebUse        bool   // agent web tools (web_search + fetch_url) enabled
	WebSearchUse  bool   // default search preference before a browser setting is saved
	LearningUse   bool   // learning storage, retrieval tools, and feedback enabled
	SearxngURL    string // external SearXNG instance; "" => launcher manages one
	SearxngPort   string // preferred port for the managed SearXNG
	McpUse        bool   // agent MCP tools from mcp.json enabled
	McpConfig     string // extra mcp.json path(s), comma-separated
	DbmcpUse      bool   // built-in multi-db MCP server enabled
	DbmcpSpec     string // explicit spec path; "" => <home>/spec.yml then spec.yaml
	DbmcpBin      string // explicit dbmcp binary; "" => <root>/build/dbmcp
	ScriptUse     bool   // agent run_script tool enabled
	ScriptPython  string // run_script interpreter; "" => the agent's default

	Passthrough map[string]string
	ConfigPath  string // the file we read (whether or not it existed)
}
