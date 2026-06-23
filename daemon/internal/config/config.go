package config

import (
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const (
	EnvRoot       = "CODEBERG_ROOT"
	EnvModel      = "CBERG_MODEL"
	EnvIndexPath  = "CBERG_INDEX_PATH"
	EnvPollMS     = "CBERG_POLL_MS"
	EnvSocket     = "CBERG_SOCKET"
	EnvIndexerBin = "CBERG_INDEX_BIN"
	EnvHTTPPort   = "CODEBERG_HTTP_PORT"
	EnvGitPullSec = "CODEBERG_GIT_PULL_INTERVAL_SEC"
	EnvGitDir     = "CODEBERG_GIT_DIR"
)

type Indexer struct {
	Root   string
	Model  string
	Index  string
	PollMS int
	Socket string
	Bin    string
}

type Daemon struct {
	Indexer
	HTTPPort string
	GitPull  time.Duration
	GitDir   string
}

func LoadDaemon() (Daemon, error) {
	idx, err := loadIndexer()
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

func loadIndexer() (Indexer, error) {
	root := os.Getenv(EnvRoot)
	if root == "" {
		return Indexer{}, missing(EnvRoot)
	}
	resolved, err := resolveRoot(root)
	if err != nil {
		return Indexer{}, invalid(EnvRoot)
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
	if poll <= 0 {
		poll = 1000
	}
	socket := os.Getenv(EnvSocket)
	if socket == "" {
		socket = "/tmp/codeberg-index.sock"
	}
	return Indexer{
		Root:   resolved,
		Model:  model,
		Index:  indexPath,
		PollMS: poll,
		Socket: socket,
		Bin:    os.Getenv(EnvIndexerBin),
	}, nil
}

func resolveRoot(root string) (string, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return abs, nil
	}
	return real, nil
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
