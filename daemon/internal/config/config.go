package config

import (
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	EnvRoot       = "CODEBERG_ROOT"
	EnvRoots      = "CODEBERG_ROOTS"
	EnvModel      = "CBERG_MODEL"
	EnvIndexPath  = "CBERG_INDEX_PATH"
	EnvPollMS     = "CBERG_POLL_MS"
	EnvSocket     = "CBERG_SOCKET"
	EnvIndexerBin = "CBERG_INDEX_BIN"
	EnvHTTPPort   = "CODEBERG_HTTP_PORT"
	EnvGitPullSec = "CODEBERG_GIT_PULL_INTERVAL_SEC"
	EnvGitDir     = "CODEBERG_GIT_DIR"
)

// RepoRoot is one served repository: a stable human-facing key (the launcher
// registry's identity, also used by the C engine in search results and by the
// agent's `repo` tool arguments) and its resolved absolute root.
type RepoRoot struct {
	Key  string
	Path string
}

type Indexer struct {
	// Root is the first (or only) root — kept for single-root consumers like
	// the git-pull default and the CODEBERG_ROOT env forwarded to the C engine.
	Root string
	// Roots is every repository served this run. Single-root mode holds one
	// entry keyed by the root's basename.
	Roots []RepoRoot
	// DefaultKey is the repo tools fall back to when no repo is named: the
	// single root's key, or "" in --all mode (where a repo must be explicit).
	DefaultKey string
	Model      string
	Index      string
	PollMS     int
	Socket     string
	Bin        string
}

type Daemon struct {
	Indexer
	HTTPPort string
	GitPull  time.Duration
	GitDirs  []string
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
	gitDirs := make([]string, 0, len(idx.Roots))
	if dir := os.Getenv(EnvGitDir); dir != "" {
		gitDirs = append(gitDirs, dir)
	} else {
		for _, r := range idx.Roots {
			gitDirs = append(gitDirs, r.Path)
		}
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
		GitDirs:  gitDirs,
	}, nil
}

func loadIndexer() (Indexer, error) {
	roots, defaultKey, err := loadRoots()
	if err != nil {
		return Indexer{}, err
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
		Root:       roots[0].Path,
		Roots:      roots,
		DefaultKey: defaultKey,
		Model:      model,
		Index:      indexPath,
		PollMS:     poll,
		Socket:     socket,
		Bin:        os.Getenv(EnvIndexerBin),
	}, nil
}

// loadRoots resolves the served repos. CODEBERG_ROOTS ("<key>\t<path>" records,
// newline-separated — the same shape the launcher registry stores) wins and
// means multi-repo mode (no default repo); CODEBERG_ROOT alone is single-root
// mode with the basename as both key and default. Dead or malformed records are
// skipped with a log line, mirroring the C engine, so one deleted tree does not
// take the daemon down.
func loadRoots() ([]RepoRoot, string, error) {
	if raw := os.Getenv(EnvRoots); raw != "" {
		var roots []RepoRoot

		for _, line := range strings.Split(raw, "\n") {
			key, path, ok := strings.Cut(line, "\t")
			if !ok || key == "" || path == "" {
				continue
			}

			resolved, err := resolveRoot(path)
			if err != nil {
				log.Printf("skipping repo %q: unresolvable root %q", key, path)
				continue
			}
			if _, err := os.Stat(resolved); err != nil {
				log.Printf("skipping repo %q: missing root %q", key, resolved)
				continue
			}

			roots = append(roots, RepoRoot{Key: key, Path: resolved})
		}

		if len(roots) == 0 {
			return nil, "", invalid(EnvRoots)
		}

		// A lone record keeps a default repo (tools may omit `repo`); with
		// several repos there is no sensible default, so repo must be explicit.
		if len(roots) == 1 {
			return roots, roots[0].Key, nil
		}

		return roots, "", nil
	}

	root := os.Getenv(EnvRoot)
	if root == "" {
		return nil, "", missing(EnvRoot)
	}

	resolved, err := resolveRoot(root)
	if err != nil {
		return nil, "", invalid(EnvRoot)
	}

	key := filepath.Base(resolved)
	return []RepoRoot{{Key: key, Path: resolved}}, key, nil
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
