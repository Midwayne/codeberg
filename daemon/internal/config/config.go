package config

import (
	"time"

	"codeberg.org/codeberg/daemon/internal/domain"
)

const (
	EnvRoots          = "CODEBERG_ROOTS"
	EnvModel          = "CBERG_MODEL"
	EnvEmbedBackend   = "CBERG_EMBED_BACKEND"
	EnvEmbedWorker    = "CBERG_EMBED_WORKER"
	EnvEmbedPython    = "CBERG_EMBED_PYTHON"
	EnvLlamaServer    = "CBERG_LLAMA_SERVER"
	EnvIndexPath      = "CBERG_INDEX_PATH"
	EnvIndexNamespace = "CODEBERG_INDEX_NAMESPACE"
	EnvIndexBackend   = "CBERG_INDEX_BACKEND"
	EnvIndexQuant     = "CBERG_INDEX_QUANT"
	EnvVectorDBURL    = "CBERG_VECTORDB_URL"
	EnvVectorDBKey    = "CBERG_VECTORDB_API_KEY"
	EnvPostgresURL    = "CBERG_POSTGRES_URL"
	EnvPollMS         = "CBERG_POLL_MS"
	EnvSocket         = "CBERG_SOCKET"
	EnvIndexerBin     = "CBERG_INDEX_BIN"
	EnvVector         = "CODEBERG_VECTOR"
	EnvHome           = "CODEBERG_HOME"
	EnvLogDir         = "CODEBERG_LOG_DIR"
	EnvHTTPPort       = "CODEBERG_HTTP_PORT"
	EnvGitPullSec     = "CODEBERG_GIT_PULL_INTERVAL_SEC"
	EnvHealthTimeout  = "CODEBERG_HEALTH_TIMEOUT"
	EnvNoIndex        = "CODEBERG_NO_INDEX"
	EnvRootPID        = "CODEBERG_RESOURCE_ROOT_PID"
)

// DefaultHTTPPort matches the launcher and agent defaults.
const DefaultHTTPPort = "48080"

// Indexer is one cberg-index process's settings. The project manager fills
// the per-project fields (Roots, DefaultKey, Index, LogDir, Socket).
type Indexer struct {
	LogDir string
	// Roots is every repository served by this indexer.
	Roots []domain.Repo
	// DefaultKey is the repo tools fall back to when no repo is named: the
	// single root's key, or "" when several roots make the repo explicit.
	DefaultKey   string
	Model        string
	EmbedBackend string
	EmbedWorker  string
	EmbedPython  string
	LlamaServer  string
	Index        string
	// IndexNamespace separates the vector indexes of different embedding models.
	IndexNamespace string
	IndexBackend   string
	IndexQuant     string
	VectorDBURL    string
	VectorDBKey    string
	PostgresURL    string
	PollMS         int
	Socket         string
	Bin            string
}

// VectorsEnabled reports whether the indexer embeds chunks.
func (c Indexer) VectorsEnabled() bool {
	return c.Model != ""
}

// RemoteIndex reports whether vectors live in a provider whose collection
// names derive from the index path instead of local files.
func (c Indexer) RemoteIndex() bool {
	return c.IndexBackend != "" && c.IndexBackend != "usearch"
}

type Daemon struct {
	Indexer
	Home     string
	LogDir   string
	HTTPPort string
	GitPull  time.Duration
	// HealthTimeout overrides the scaled indexer startup deadline when > 0.
	HealthTimeout time.Duration
	// NoIndex keeps a session's catalog and indexes out of Home.
	NoIndex bool
	// RootPID is the launcher process whose tree resource monitoring covers.
	RootPID int
}

func invalid(name string) error {
	return &Error{Var: name, Msg: "invalid value"}
}

type Error struct {
	Var string
	Msg string
}

func (e *Error) Error() string {
	return e.Var + ": " + e.Msg
}
