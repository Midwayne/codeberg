package config

import (
	"time"

	"codeberg.org/codeberg/daemon/internal/domain"
)

const (
	EnvRoot         = "CODEBERG_ROOT"
	EnvRoots        = "CODEBERG_ROOTS"
	EnvModel        = "CBERG_MODEL"
	EnvEmbedBackend = "CBERG_EMBED_BACKEND"
	EnvEmbedWorker  = "CBERG_EMBED_WORKER"
	EnvEmbedPython  = "CBERG_EMBED_PYTHON"
	EnvLlamaServer  = "CBERG_LLAMA_SERVER"
	EnvIndexPath    = "CBERG_INDEX_PATH"
	EnvIndexBackend = "CBERG_INDEX_BACKEND"
	EnvIndexQuant   = "CBERG_INDEX_QUANT"
	EnvVectorDBURL  = "CBERG_VECTORDB_URL"
	EnvVectorDBKey  = "CBERG_VECTORDB_API_KEY"
	EnvPostgresURL  = "CBERG_POSTGRES_URL"
	EnvPollMS       = "CBERG_POLL_MS"
	EnvSocket       = "CBERG_SOCKET"
	EnvIndexerBin   = "CBERG_INDEX_BIN"
	EnvHTTPPort     = "CODEBERG_HTTP_PORT"
	EnvGitPullSec   = "CODEBERG_GIT_PULL_INTERVAL_SEC"
	EnvGitDir       = "CODEBERG_GIT_DIR"
)

type Indexer struct {
	LogDir string
	// Root is the first (or only) root — kept for single-root consumers like
	// the git-pull default and the CODEBERG_ROOT env forwarded to the C engine.
	Root string
	// Roots is every repository served this run.
	Roots []domain.Repo
	// DefaultKey is the repo tools fall back to when no repo is named: the
	// single root's key, or "" in --all mode (where a repo must be explicit).
	DefaultKey   string
	Model        string
	EmbedBackend string
	EmbedWorker  string
	EmbedPython  string
	LlamaServer  string
	Index        string
	IndexBackend string
	IndexQuant   string
	VectorDBURL  string
	VectorDBKey  string
	PostgresURL  string
	PollMS       int
	Socket       string
	Bin          string
}

type Daemon struct {
	Indexer
	HTTPPort string
	GitPull  time.Duration
	GitDirs  []string
}

func missing(name string) error {
	return &Error{Var: name, Msg: "required"}
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
