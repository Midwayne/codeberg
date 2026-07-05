package workspace

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/bmatcuk/doublestar/v4"

	"codeberg.org/codeberg/daemon/internal/domain"
)

const (
	defaultMaxMatches = 200
	defaultMaxFiles   = 500
	defaultMaxBytes   = 64 * 1024
	scanBufInit       = 64 * 1024
	scanBufMax        = 4 * 1024 * 1024
	matchFields       = 3
	maxRawBytes       = 4 * 1024 * 1024
	defaultTreeDepth  = 3
	maxTreeEntries    = 2000
)

var (
	ErrNotFound = errors.New("codeberg: not found")
	ErrEscape   = errors.New("codeberg: path escapes repo root")
	errStopWalk = errors.New("stop walk")
)

// RepoInfo is one repository the workspace serves.
type RepoInfo = domain.Repo

type Workspace struct {
	repos      []RepoInfo
	byKey      map[string]string
	defaultKey string
	maxMatches int
	maxFiles   int
	maxBytes   int
}

// New builds a workspace over one or more repos. defaultKey names the repo
// used when a tool omits `repo` — the single root's key in single-repo mode,
// or "" in --all mode, where every call must name its repo.
func New(repos []RepoInfo, defaultKey string) *Workspace {
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
func (w *Workspace) Repos() []RepoInfo {
	out := make([]RepoInfo, len(w.repos))
	copy(out, w.repos)
	return out
}

type GrepMatch struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
	Line uint32 `json:"line"`
	Text string `json:"text"`
}

type FileRef struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
}

type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
}

type FileContent struct {
	Content    string `json:"content"`
	StartLine  uint32 `json:"start_line"`
	EndLine    uint32 `json:"end_line"`
	TotalLines uint32 `json:"total_lines"`
}

type TreeNode struct {
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Depth int    `json:"depth"`
}

// resolveKey canonicalizes a tool's `repo` argument. "" (and the legacy alias
// "root") means the default repo; in --all mode there is no default, so the
// error lists what is available. The returned key is what results should carry.
func (w *Workspace) resolveKey(repo string) (string, error) {
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
	key, err := w.resolveKey(repo)
	if err != nil {
		return "", err
	}
	return w.byKey[key], nil
}

func (w *Workspace) Grep(ctx context.Context, pattern string, literal bool, repo, pathGlob string, limit int) ([]GrepMatch, error) {
	if pattern == "" {
		return nil, fmt.Errorf("codeberg: grep: empty pattern")
	}

	if limit <= 0 || limit > w.maxMatches {
		limit = w.maxMatches
	}

	key, err := w.resolveKey(repo)
	if err != nil {
		return nil, err
	}

	dir := w.byKey[key]
	if _, statErr := os.Stat(dir); statErr != nil {
		return nil, fmt.Errorf("%w: repo", ErrNotFound)
	}

	hits, err := grepRoot(ctx, dir, pattern, literal, pathGlob, limit)
	if err != nil {
		return nil, err
	}

	for i := range hits {
		hits[i].Repo = key
	}

	return hits, nil
}

func grepRoot(ctx context.Context, dir, pattern string, literal bool, pathGlob string, limit int) ([]GrepMatch, error) {
	args := []string{"--no-heading", "--line-number", "--with-filename", "--color=never", "--no-messages"}
	if literal {
		args = append(args, "--fixed-strings")
	}
	if pathGlob != "" {
		args = append(args, "--glob", pathGlob)
	}
	args = append(args, "--", pattern, ".")

	cmd := exec.CommandContext(ctx, "rg", args...)
	cmd.Dir = dir

	out, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			return nil, nil
		}
		return nil, fmt.Errorf("codeberg: grep: %w", err)
	}

	var matches []GrepMatch
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 0, scanBufInit), scanBufMax)

	for sc.Scan() {
		m, ok := parseGrep(sc.Text())
		if !ok {
			continue
		}
		matches = append(matches, m)
		if len(matches) >= limit {
			break
		}
	}

	return matches, sc.Err()
}

func parseGrep(line string) (GrepMatch, bool) {
	parts := strings.SplitN(line, ":", matchFields)
	if len(parts) != matchFields {
		return GrepMatch{}, false
	}
	n, err := strconv.ParseUint(parts[1], 10, 32)
	if err != nil {
		return GrepMatch{}, false
	}
	path := strings.TrimPrefix(filepath.ToSlash(parts[0]), "./")
	return GrepMatch{Path: path, Line: uint32(n), Text: parts[2]}, true
}

func (w *Workspace) Glob(_ context.Context, pattern, repo string, limit int) ([]FileRef, error) {
	if pattern == "" {
		return nil, fmt.Errorf("codeberg: glob: empty pattern")
	}
	if limit <= 0 || limit > w.maxFiles {
		limit = w.maxFiles
	}
	repoKey, err := w.resolveKey(repo)
	if err != nil {
		return nil, err
	}
	dir := w.byKey[repoKey]
	fsys := os.DirFS(dir)
	ms, globErr := doublestar.Glob(fsys, pattern, doublestar.WithFilesOnly())
	if globErr != nil {
		return nil, fmt.Errorf("codeberg: glob: %w", globErr)
	}
	sort.Strings(ms)
	var files []FileRef
	for _, m := range ms {
		files = append(files, FileRef{Repo: repoKey, Path: filepath.ToSlash(m)})
		if len(files) >= limit {
			break
		}
	}
	return files, nil
}

func (w *Workspace) ReadFile(repo, path string, startLine, endLine uint32) (FileContent, error) {
	root, err := w.rootFor(repo)
	if err != nil {
		return FileContent{}, err
	}

	full, err := resolve(root, path)
	if err != nil {
		return FileContent{}, err
	}

	data, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			return FileContent{}, fmt.Errorf("%w: %s", ErrNotFound, path)
		}
		return FileContent{}, fmt.Errorf("codeberg: read file: %w", err)
	}

	lines := strings.Split(string(data), "\n")
	total := uint32(len(lines))

	start := startLine
	if start == 0 {
		start = 1
	}

	end := endLine
	if end == 0 || end > total {
		end = total
	}
	if start > total {
		start = total
	}
	if end < start {
		end = start
	}

	content := strings.Join(lines[start-1:end], "\n")
	if len(content) > w.maxBytes {
		content = content[:w.maxBytes]
	}

	return FileContent{Content: content, StartLine: start, EndLine: end, TotalLines: total}, nil
}

func (w *Workspace) ListDir(repo, path string) ([]DirEntry, error) {
	root, err := w.rootFor(repo)
	if err != nil {
		return nil, err
	}
	full, err := resolve(root, path)
	if err != nil {
		return nil, err
	}
	infos, err := os.ReadDir(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: %s", ErrNotFound, path)
		}
		return nil, fmt.Errorf("codeberg: list dir: %w", err)
	}
	entries := make([]DirEntry, 0, len(infos))
	for _, e := range infos {
		entries = append(entries, DirEntry{Name: e.Name(), IsDir: e.IsDir()})
	}
	return entries, nil
}

func (w *Workspace) ReadRaw(repo, path string) ([]byte, error) {
	root, err := w.rootFor(repo)
	if err != nil {
		return nil, err
	}
	full, err := resolve(root, path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, path)
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%w: %s is a directory", ErrNotFound, path)
	}
	if info.Size() > maxRawBytes {
		return nil, fmt.Errorf("codeberg: file too large: %s (%d bytes)", path, info.Size())
	}
	return os.ReadFile(full)
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

func (w *Workspace) Tree(repo, path string, maxDepth int) ([]TreeNode, error) {
	if maxDepth <= 0 {
		maxDepth = defaultTreeDepth
	}
	root, err := w.rootFor(repo)
	if err != nil {
		return nil, err
	}
	base, err := resolve(root, path)
	if err != nil {
		return nil, err
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("codeberg: resolve root: %w", err)
	}
	var nodes []TreeNode
	walkErr := filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == base {
			return nil
		}
		relBase, _ := filepath.Rel(base, p)
		depth := strings.Count(relBase, string(filepath.Separator)) + 1
		if d.IsDir() && SkipDir(d.Name()) {
			return fs.SkipDir
		}
		relRoot, _ := filepath.Rel(realRoot, p)
		nodes = append(nodes, TreeNode{Path: filepath.ToSlash(relRoot), IsDir: d.IsDir(), Depth: depth})
		if len(nodes) >= maxTreeEntries {
			return errStopWalk
		}
		if d.IsDir() && depth >= maxDepth {
			return fs.SkipDir
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errStopWalk) {
		return nil, fmt.Errorf("codeberg: tree: %w", walkErr)
	}
	return nodes, nil
}

func SafeRel(path string) (string, error) {
	if path == "" {
		return ".", nil
	}
	clean := filepath.Clean(path)
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %s", ErrEscape, path)
	}
	return clean, nil
}

func resolve(root, rel string) (string, error) {
	if rel == "" {
		rel = "."
	}
	clean := filepath.Clean(rel)
	if filepath.IsAbs(clean) {
		return "", fmt.Errorf("%w: %s", ErrEscape, rel)
	}
	full := filepath.Join(root, clean)
	if !within(root, full) {
		return "", fmt.Errorf("%w: %s", ErrEscape, rel)
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("codeberg: resolve root: %w", err)
	}
	realFull, err := filepath.EvalSymlinks(full)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("%w: %s", ErrNotFound, rel)
		}
		return "", fmt.Errorf("codeberg: resolve path: %w", err)
	}
	if !within(realRoot, realFull) {
		return "", fmt.Errorf("%w: %s", ErrEscape, rel)
	}
	return realFull, nil
}

func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}
