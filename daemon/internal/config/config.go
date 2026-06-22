package config

import (
	"os"
	"path/filepath"
	"strconv"
	"time"

	"codeberg.org/codeberg/daemon/internal/cberg"
)

const (
	EnvRoot       = "CODEBERG_ROOT"
	EnvModel      = "CBERG_MODEL"
	EnvIndexPath  = "CBERG_INDEX_PATH"
	EnvPollMS     = "CBERG_POLL_MS"
	EnvHTTPPort   = "CODEBERG_HTTP_PORT"
	EnvGitPullSec = "CODEBERG_GIT_PULL_INTERVAL_SEC"
	EnvGitDir     = "CODEBERG_GIT_DIR"
)

type Indexer struct {
	Root    string
	Model   string
	Index   string
	Poll    time.Duration
	Vectors bool
}

type Daemon struct {
	Indexer
	HTTPPort string
	GitPull  time.Duration
	GitDir   string
}

func LoadIndexer() (Indexer, error) {
	root := os.Getenv(EnvRoot)
	if root == "" {
		return Indexer{}, missing(EnvRoot)
	}
	resolved, err := cberg.ResolveIndexRoot()
	if err != nil {
		resolved, err = filepath.Abs(root)
		if err != nil {
			return Indexer{}, invalid(EnvRoot)
		}
	}
	model := os.Getenv(EnvModel)
	indexPath := os.Getenv(EnvIndexPath)
	poll := 1000
	if v := os.Getenv(EnvPollMS); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return Indexer{}, invalid(EnvPollMS)
		}
		poll = n
	}
	vectors := model != "" && indexPath != ""
	return Indexer{
		Root:    resolved,
		Model:   model,
		Index:   indexPath,
		Poll:    time.Duration(poll) * time.Millisecond,
		Vectors: vectors,
	}, nil
}

func LoadDaemon() (Daemon, error) {
	idx, err := LoadIndexer()
	if err != nil {
		return Daemon{}, err
	}
	port := os.Getenv(EnvHTTPPort)
	if port == "" {
		port = "8080"
	}
	gitDir := os.Getenv(EnvGitDir)
	if gitDir == "" {
		gitDir = idx.Root
	}
	var pull time.Duration
	if v := os.Getenv(EnvGitPullSec); v != "" {
		sec, err := strconv.Atoi(v)
		if err != nil || sec < 0 {
			return Daemon{}, invalid(EnvGitPullSec)
		}
		pull = time.Duration(sec) * time.Second
	}
	return Daemon{
		Indexer:  idx,
		HTTPPort: port,
		GitPull:  pull,
		GitDir:   gitDir,
	}, nil
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
