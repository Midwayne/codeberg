// Package projects owns the persistent catalog and independently supervised
// project indexers. Selection belongs to a request, never to a global variable.
package projects

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"codeberg.org/codeberg/daemon/internal/bootstrap"
	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/domain"
	"codeberg.org/codeberg/daemon/internal/gitpull"
	"codeberg.org/codeberg/daemon/internal/httpserver"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/supervisor"
	"codeberg.org/codeberg/daemon/internal/tools"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

type Project struct {
	ID    string        `json:"id"`
	Name  string        `json:"name"`
	Roots []domain.Repo `json:"roots"`
	// Keep the original provider namespace on upgrade (remote names hash this path).
	LegacyIndex string `json:"legacyIndex,omitempty"`
}
type Catalog struct {
	Version   int       `json:"version"`
	DefaultID string    `json:"defaultId"`
	LegacyID  string    `json:"legacyId"`
	Projects  []Project `json:"projects"`
}
type runtime struct {
	handler http.Handler
	stop    func()
	started time.Time
}
type Manager struct {
	ctx      context.Context
	home     string
	base     config.Indexer
	catalog  Catalog
	mu       sync.Mutex
	runtimes map[string]runtime
	closed   bool
	gitPull  time.Duration
	start    func(Project, config.Indexer) (http.Handler, func(), error)
}

func New(ctx context.Context, home string, cfg config.Indexer) (*Manager, error) {
	m := &Manager{ctx: ctx, home: home, base: cfg, runtimes: make(map[string]runtime)}
	raw, err := os.ReadFile(filepath.Join(home, "projects.json"))
	if err == nil {
		if err := json.Unmarshal(raw, &m.catalog); err != nil {
			return nil, fmt.Errorf("reading project catalog: %w", err)
		}
		if m.catalog.Version != 1 {
			return nil, fmt.Errorf("unsupported project catalog version %d", m.catalog.Version)
		}
		seen := map[string]bool{}
		for _, p := range m.catalog.Projects {
			if !validID(p.ID) || seen[p.ID] || len(p.Roots) == 0 {
				return nil, fmt.Errorf("invalid project catalog")
			}
			seen[p.ID] = true
		}
		if !seen[m.catalog.LegacyID] || !seen[m.catalog.DefaultID] {
			return nil, fmt.Errorf("project catalog has no valid default or migration owner")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	} else {
		m.catalog.Version = 1
	}
	p := Project{ID: projectID(cfg.Roots), Name: filepath.Base(cfg.Root), Roots: cfg.Roots}
	if len(cfg.Roots) > 1 {
		p.Name = "Existing workspace"
	}
	exists := false
	for _, candidate := range m.catalog.Projects {
		if candidate.ID == p.ID {
			exists = true
		}
	}
	if !exists {
		if len(m.catalog.Projects) == 0 {
			p.LegacyIndex = cfg.Index
			m.catalog.LegacyID = p.ID
		}
		m.catalog.Projects = append(m.catalog.Projects, p)
	}
	m.catalog.DefaultID = p.ID
	if err := m.save(); err != nil {
		return nil, err
	}
	m.start = m.startIndexer
	return m, nil
}

func validID(id string) bool {
	if len(id) != 18 || !strings.HasPrefix(id, "p-") {
		return false
	}
	_, err := hex.DecodeString(id[2:])
	return err == nil
}
func projectID(roots []domain.Repo) string {
	var paths []string
	for _, r := range roots {
		paths = append(paths, r.Root)
	}
	sum := sha256.Sum256([]byte(strings.Join(paths, "\x00")))
	return "p-" + hex.EncodeToString(sum[:8])
}
func (m *Manager) save() error {
	if err := os.MkdirAll(m.home, 0700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(m.catalog, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(m.home, ".projects-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(m.home, "projects.json"))
}
func (m *Manager) Add(name, root string) (Project, error) {
	if !filepath.IsAbs(root) || strings.ContainsAny(root, "\x00\n\r\t") {
		return Project{}, fmt.Errorf("choose an absolute directory path")
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return Project{}, fmt.Errorf("directory is unavailable: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return Project{}, fmt.Errorf("choose an existing directory")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(root)
	}
	if utf8.RuneCountInString(name) > 120 {
		return Project{}, fmt.Errorf("project name must be 120 characters or shorter")
	}
	roots := []domain.Repo{{Key: filepath.Base(root), Root: root}}
	p := Project{ID: projectID(roots), Name: name, Roots: roots}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.catalog.Projects {
		if existing.ID == p.ID {
			return existing, nil
		}
	}
	m.catalog.Projects = append(m.catalog.Projects, p)
	if err := m.save(); err != nil {
		m.catalog.Projects = m.catalog.Projects[:len(m.catalog.Projects)-1]
		return Project{}, err
	}
	return p, nil
}

var errProjectNotFound = errors.New("project not found")
var errProjectName = errors.New("project name must contain 1 to 120 characters")

// Rename changes only the display label; roots, IDs and running indexers stay stable.
func (m *Manager) Rename(id, name string) (Project, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return Project{}, errProjectName
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.catalog.Projects {
		if p.ID != id {
			continue
		}
		m.catalog.Projects[i].Name = name
		if err := m.save(); err != nil {
			m.catalog.Projects[i] = p
			return Project{}, err
		}
		return m.catalog.Projects[i], nil
	}
	return Project{}, errProjectNotFound
}
func (m *Manager) project(id string) (Project, bool) {
	for _, p := range m.catalog.Projects {
		if p.ID == id {
			return p, true
		}
	}
	return Project{}, false
}
func (m *Manager) projectConfig(p Project) config.Indexer {
	cfg := m.base
	cfg.Roots = p.Roots
	cfg.Root = p.Roots[0].Root
	cfg.DefaultKey = ""
	if len(p.Roots) == 1 {
		cfg.DefaultKey = p.Roots[0].Key
	}
	dir := filepath.Join(m.home, "projects", p.ID)
	cfg.Index = filepath.Join(dir, "index", "codeberg.usearch")
	cfg.LogDir = filepath.Join(dir, "logs")
	// Unix socket paths have a small OS limit; names still include home identity.
	sum := sha256.Sum256([]byte(dir))
	cfg.Socket = filepath.Join(os.TempDir(), "cberg-"+hex.EncodeToString(sum[:12])+".sock")
	if p.LegacyIndex != "" && ((cfg.IndexBackend != "" && cfg.IndexBackend != "usearch") || !strings.HasPrefix(p.LegacyIndex, filepath.Join(m.home, "index")+string(filepath.Separator))) {
		cfg.Index = p.LegacyIndex
	}
	return cfg
}

// InitialConfig migrates local caches before the initial indexer starts. A remote
// store retains its namespace to avoid silently rebuilding into another table.
func (m *Manager) InitialConfig() (config.Indexer, error) {
	p, _ := m.project(m.catalog.DefaultID)
	cfg := m.projectConfig(p)
	// Preserve the configured initial IPC endpoint for existing local clients.
	if m.base.Socket != "" {
		cfg.Socket = m.base.Socket
	}
	if err := os.MkdirAll(filepath.Dir(cfg.Index), 0700); err != nil {
		return cfg, err
	}
	if p.LegacyIndex != "" && p.LegacyIndex != cfg.Index {
		files, err := filepath.Glob(p.LegacyIndex + ".*")
		if err != nil {
			return cfg, err
		}
		if _, err := os.Stat(p.LegacyIndex); err == nil {
			files = append(files, p.LegacyIndex)
		}
		for _, source := range files {
			target := cfg.Index + strings.TrimPrefix(source, p.LegacyIndex)
			if _, err := os.Stat(target); err == nil {
				return cfg, fmt.Errorf("index migration conflict: %s", target)
			} else if !os.IsNotExist(err) {
				return cfg, err
			}
			if err := os.Rename(source, target); err != nil {
				return cfg, fmt.Errorf("migrating index %s: %w", source, err)
			}
		}
	}
	return cfg, nil
}
func (m *Manager) BindDefault(handler http.Handler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runtimes[m.catalog.DefaultID] = runtime{handler: handler, stop: func() {}, started: time.Now()}
}
func (m *Manager) startIndexer(p Project, cfg config.Indexer) (http.Handler, func(), error) {
	if err := os.MkdirAll(filepath.Dir(cfg.Index), 0700); err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithCancel(m.ctx)
	sup, err := supervisor.Start(ctx, cfg)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	repos := make([]workspace.RepoInfo, 0, len(p.Roots))
	for _, r := range p.Roots {
		repos = append(repos, workspace.RepoInfo{Key: r.Key, Root: r.Root})
	}
	if m.gitPull > 0 {
		dirs := make([]string, 0, len(p.Roots))
		for _, r := range p.Roots {
			dirs = append(dirs, r.Root)
		}
		go gitpull.Run(ctx, dirs, m.gitPull)
	}
	idx := indexctl.NewClient(cfg.Socket)
	ws := workspace.New(repos, cfg.DefaultKey)
	return httpserver.New(idx, tools.Default(ws, idx)).Handler(), func() { sup.Stop(); cancel() }, nil
}
func (m *Manager) activate(id string) (http.Handler, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, fmt.Errorf("projects are shutting down")
	}
	if rt, ok := m.runtimes[id]; ok {
		return rt.handler, nil
	}
	p, ok := m.project(id)
	if !ok {
		return nil, fmt.Errorf("unknown project")
	}
	handler, stop, err := m.start(p, m.projectConfig(p))
	if err != nil {
		return nil, err
	}
	m.runtimes[id] = runtime{handler: handler, stop: stop, started: time.Now()}
	return handler, nil
}
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = true
	for _, rt := range m.runtimes {
		rt.stop()
	}
}
func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func (m *Manager) Handler(fallback http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/projects/pick-directory" {
			desktopFolderPicker.ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/projects" {
			switch r.Method {
			case "GET":
				m.mu.Lock()
				defer m.mu.Unlock()
				respond(w, 200, m.catalog)
			case "POST":
				if !sameOrigin(r) {
					respond(w, 403, map[string]string{"message": "cross-origin project changes are not allowed"})
					return
				}
				var body struct {
					Name string `json:"name"`
					Root string `json:"root"`
				}
				if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
					respond(w, 400, map[string]string{"message": "invalid project"})
					return
				}
				p, err := m.Add(body.Name, body.Root)
				if err != nil {
					respond(w, 400, map[string]string{"message": err.Error()})
					return
				}
				respond(w, 201, p)
			default:
				respond(w, 405, map[string]string{"message": "method not allowed"})
			}
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/projects/") {
			if r.URL.Path == "/health" {
				m.serveHealth(fallback, w, r, m.catalog.DefaultID)
			} else {
				fallback.ServeHTTP(w, r)
			}
			return
		}
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/projects/"), "/", 2)
		m.mu.Lock()
		_, ok := m.project(parts[0])
		m.mu.Unlock()
		if !ok {
			respond(w, 404, map[string]string{"message": "project not found"})
			return
		}
		if len(parts) == 1 {
			if r.Method != "PATCH" {
				respond(w, 405, map[string]string{"message": "method not allowed"})
				return
			}
			if !sameOrigin(r) {
				respond(w, 403, map[string]string{"message": "cross-origin project changes are not allowed"})
				return
			}
			var body struct {
				Name string `json:"name"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
				respond(w, 400, map[string]string{"message": "invalid project name"})
				return
			}
			p, err := m.Rename(parts[0], body.Name)
			if err != nil {
				status := 500
				if errors.Is(err, errProjectName) {
					status = 400
				}
				if errors.Is(err, errProjectNotFound) {
					status = 404
				}
				respond(w, status, map[string]string{"message": err.Error()})
				return
			}
			respond(w, 200, p)
			return
		}
		if parts[1] == "retry" {
			if r.Method != "POST" {
				respond(w, 405, map[string]string{"message": "method not allowed"})
				return
			}
			if !sameOrigin(r) {
				respond(w, 403, map[string]string{"message": "cross-origin project changes are not allowed"})
				return
			}
			m.mu.Lock()
			rt, active := m.runtimes[parts[0]]
			if active {
				rt.started = time.Now()
				m.runtimes[parts[0]] = rt
			}
			m.mu.Unlock()
			respond(w, 200, map[string]bool{"ok": true})
			return
		}
		handler, err := m.activate(parts[0])
		if err != nil {
			respond(w, 503, map[string]string{"message": err.Error()})
			return
		}
		next := r.Clone(r.Context())
		next.URL.Path = "/" + parts[1]
		if parts[1] == "health" {
			m.serveHealth(handler, w, next, parts[0])
			return
		}

		handler.ServeHTTP(w, next)
	})
}

// Response buffer keeps not-yet-open IPC sockets from becoming opaque UI errors.
type httptestResponse struct {
	header http.Header
	status int
	body   []byte
}

func (w *httptestResponse) Header() http.Header    { return w.header }
func (w *httptestResponse) WriteHeader(status int) { w.status = status }
func (w *httptestResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	w.body = append(w.body, b...)
	return len(b), nil
}
func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || origin == "http://"+r.Host || origin == "https://"+r.Host
}

func (m *Manager) WithGitPull(interval time.Duration) *Manager { m.gitPull = interval; return m }
func (m *Manager) serveHealth(handler http.Handler, w http.ResponseWriter, r *http.Request, id string) {
	m.mu.Lock()
	project, _ := m.project(id)
	m.mu.Unlock()
	for _, root := range project.Roots {
		info, err := os.Stat(root.Root)
		if err != nil || !info.IsDir() {
			respond(w, 503, map[string]any{"ready": false, "status": "error", "message": "Project directory is unavailable: " + root.Root})
			return
		}
	}
	buffered := httptestResponse{header: make(http.Header)}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	handler.ServeHTTP(&buffered, r.WithContext(ctx))
	var health struct {
		Ready bool `json:"ready"`
	}
	_ = json.Unmarshal(buffered.body, &health)
	m.mu.Lock()
	rt := m.runtimes[id]
	p, _ := m.project(id)
	m.mu.Unlock()
	if !health.Ready && !rt.started.IsZero() && time.Since(rt.started) > bootstrap.StartupTimeout(len(p.Roots)) {
		respond(w, 503, map[string]any{"ready": false, "status": "error", "message": "Project indexing has not become ready. Check the project indexer log and retry."})
		return
	}
	if buffered.status >= 400 {
		respond(w, 200, map[string]any{"ready": false, "chunks": 0, "status": "indexing"})
		return
	}
	for k, vs := range buffered.header {
		w.Header()[k] = vs
	}
	w.WriteHeader(buffered.status)
	_, _ = w.Write(buffered.body)
}
