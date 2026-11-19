package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func touch(t *testing.T, root string, rels ...string) {
	t.Helper()

	for _, rel := range rels {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}

		if strings.HasSuffix(rel, "/") {
			continue
		}

		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// teamDir is a project directory with repositories in several shapes.
func teamDir(t *testing.T) string {
	t.Helper()

	team := filepath.Join(t.TempDir(), "team-a")
	touch(t, team,
		"README.md",
		"api/.git/HEAD",
		"api/sub/go.mod",
		"storage/go.mod",
		"web/package.json",
		"tools/b/Cargo.toml",
		"tools/notes.txt",
		"node_modules/dep/package.json",
		".cache/thing/go.mod",
		"a/b/c/d/go.mod",
	)

	return team
}

func discoveredPaths(found []Discovered) []string {
	var out []string

	for _, d := range found {
		out = append(out, d.Path)
	}

	return out
}

func TestDiscoverFindsRepositoriesByGitOrManifest(t *testing.T) {
	found := discoverRepositories(teamDir(t), nil)

	want := []string{"api", "storage", "tools/b", "web"}
	if got := discoveredPaths(found); !reflect.DeepEqual(got, want) {
		t.Fatalf("discovered %v, want %v", got, want)
	}

	if found[0].Marker != ".git" || found[1].Marker != "go.mod" {
		t.Fatalf("markers = %+v", found)
	}
}

func TestDiscoverKeepsARepositoryDirectoryWhole(t *testing.T) {
	repo := t.TempDir()
	touch(t, repo, ".git/HEAD", "services/api/go.mod")

	if found := discoverRepositories(repo, nil); len(found) != 0 {
		t.Fatalf("a repository was split: %v", discoveredPaths(found))
	}
}

func TestDiscoverSkipsIgnoredFolders(t *testing.T) {
	found := discoverRepositories(teamDir(t), []string{"web", "tools/b"})

	if got := discoveredPaths(found); !reflect.DeepEqual(got, []string{"api", "storage"}) {
		t.Fatalf("discovered %v", got)
	}
}

func TestDiscoveredKeysAreUnique(t *testing.T) {
	team := filepath.Join(t.TempDir(), "svc")
	touch(t, team, "x/svc/go.mod", "y/svc/go.mod", "z/svc/go.mod")

	roots := rootsFor(team, discoverRepositories(team, nil))

	var keys []string
	for _, r := range roots {
		keys = append(keys, r.Key)
	}

	if want := []string{"svc", "x-svc", "y-svc", "z-svc"}; !reflect.DeepEqual(keys, want) {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
}

func TestAddSplitsAProjectDirectoryWithAStableID(t *testing.T) {
	m, _ := setup(t)
	team := teamDir(t)

	p, err := m.AddWith(AddOptions{Root: team, Ignored: []string{"web"}})
	if err != nil {
		t.Fatal(err)
	}

	if p.ID != projectID(rootsFor(team, nil)) || p.Directory != team || !p.Discover {
		t.Fatalf("project = %+v", p)
	}

	var roots []string
	for _, r := range p.Roots {
		roots = append(roots, r.Key+"="+r.Root)
	}

	want := []string{"team-a=" + team, "api=" + filepath.Join(team, "api"), "storage=" + filepath.Join(team, "storage"), "b=" + filepath.Join(team, "tools/b")}
	if !reflect.DeepEqual(roots, want) || !reflect.DeepEqual(p.Ignored, []string{"web"}) {
		t.Fatalf("roots = %v ignored = %v", roots, p.Ignored)
	}
}

func TestRescanSplitsAnExistingProjectWithoutChangingItsID(t *testing.T) {
	m, home := setup(t)
	team := teamDir(t)

	legacy := Project{ID: projectID(rootsFor(team, nil)), Name: "Team A", Roots: rootsFor(team, nil)}
	if _, err := m.addProject(legacy); err != nil {
		t.Fatal(err)
	}

	stopped := false
	m.runtimes[legacy.ID] = runtime{handler: http.NotFoundHandler(), stop: func() { stopped = true }}

	p, err := m.Rescan(legacy.ID, nil)
	if err != nil {
		t.Fatal(err)
	}

	if p.ID != legacy.ID || len(p.Roots) != 5 || !p.Discover || !stopped {
		t.Fatalf("rescanned = %+v stopped = %v", p, stopped)
	}

	if _, running := m.runtimes[legacy.ID]; running {
		t.Fatal("indexer kept the old roots")
	}

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()

	if got, _ := restored.project(legacy.ID); len(got.Roots) != 5 {
		t.Fatalf("restored roots = %+v", got.Roots)
	}
}

func TestStartupPicksUpNewRepositories(t *testing.T) {
	m, home := setup(t)
	team := teamDir(t)

	p, err := m.AddWith(AddOptions{Root: team})
	if err != nil {
		t.Fatal(err)
	}

	touch(t, team, "billing/.git/HEAD")

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()

	got, _ := restored.project(p.ID)
	if len(got.Roots) != len(p.Roots)+1 || got.Roots[1].Key != "api" || got.Roots[2].Key != "billing" {
		t.Fatalf("startup roots = %+v", got.Roots)
	}
}

func TestDiscoverEndpointPreviewsWithoutAdding(t *testing.T) {
	m, _ := setup(t)
	team := teamDir(t)
	before := len(m.catalog.Projects)

	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/projects/discover?root="+url.QueryEscape(team), nil)
	m.Handler(http.NotFoundHandler()).ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("discover = %d %s", w.Code, w.Body)
	}

	var preview struct {
		Directory    string       `json:"directory"`
		Repositories []Discovered `json:"repositories"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}

	if preview.Directory != team || len(preview.Repositories) != 4 || len(m.catalog.Projects) != before {
		t.Fatalf("preview = %+v, projects %d -> %d", preview, before, len(m.catalog.Projects))
	}
}

func TestRescanEndpointAppliesIgnoredFolders(t *testing.T) {
	m, _ := setup(t)

	p, err := m.AddWith(AddOptions{Root: teamDir(t)})
	if err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/projects/"+p.ID+"/rescan", strings.NewReader(`{"ignored":["api"]}`))
	m.Handler(http.NotFoundHandler()).ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("rescan = %d %s", w.Code, w.Body)
	}

	got, _ := m.project(p.ID)
	if len(got.Roots) != len(p.Roots)-1 || !reflect.DeepEqual(got.Ignored, []string{"api"}) {
		t.Fatalf("after rescan = %+v", got)
	}
}
