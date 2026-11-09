package workspace

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
)

const (
	defaultMaxMatches = 200
	defaultMaxFiles   = 500
	defaultMaxBytes   = 64 * 1024
	scanBufInit       = 64 * 1024
	scanBufMax        = 4 * 1024 * 1024
	matchFields       = 3
	grepMaxColumns    = 512
	maxRawBytes       = 4 * 1024 * 1024
	defaultTreeDepth  = 3
	maxTreeEntries    = 2000
)

var (
	ErrNotFound = errors.New("codeberg: not found")
	errStopWalk = errors.New("stop walk")
)

type Workspace struct {
	repos      []domain.Repo
	byKey      map[string]string
	defaultKey string
	maxMatches int
	maxFiles   int
	maxBytes   int
}

// New builds a workspace over one or more repos. defaultKey names the repo
// used when a tool omits `repo` — the single root's key in single-repo mode,
// or "" in --all mode, where every call must name its repo.
func New(repos []domain.Repo, defaultKey string) *Workspace {
	byKey := make(map[string]string, len(repos))

	for _, r := range repos {
		byKey[r.Key] = r.Root
	}
	return &Workspace{
		repos:      repos,
		byKey:      byKey,
		defaultKey: defaultKey,
		maxMatches: defaultMaxMatches,
		maxFiles:   defaultMaxFiles,
		maxBytes:   defaultMaxBytes,
	}
}

// Repos lists the served repositories in configuration order.
func (w *Workspace) Repos() []domain.Repo {
	out := make([]domain.Repo, len(w.repos))
	copy(out, w.repos)
	return out
}

// ResolveRepo canonicalizes a tool's `repo` argument. "" (and the legacy alias
// "root") means the default repo; in --all mode there is no default, so the
// error lists what is available. The returned key is what results should carry.
func (w *Workspace) ResolveRepo(repo string) (string, error) {
	if repo == "" || repo == "root" {
		if w.defaultKey == "" {
			return "", fmt.Errorf("%w: repo required (available: %s)", ErrNotFound, strings.Join(w.keys(), ", "))
		}
		return w.defaultKey, nil
	}

	if _, ok := w.byKey[repo]; !ok {
		return "", fmt.Errorf("%w: unknown repo %q (available: %s)", ErrNotFound, repo, strings.Join(w.keys(), ", "))
	}
	return repo, nil
}

func (w *Workspace) keys() []string {
	keys := make([]string, len(w.repos))

	for i, r := range w.repos {
		keys[i] = r.Key
	}
	return keys
}

func (w *Workspace) rootFor(repo string) (string, error) {
	key, err := w.ResolveRepo(repo)
	if err != nil {
		return "", err
	}
	return w.byKey[key], nil
}

func (w *Workspace) RepoRoot(repo string) (string, error) {
	root, err := w.rootFor(repo)
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(root); err != nil {
		return "", fmt.Errorf("%w: repo %q", ErrNotFound, repo)
	}
	return root, nil
}
