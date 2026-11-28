package projects

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/domain"
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

	// Projects store canonical paths; t.TempDir() can sit behind a symlink
	// (macOS /var -> /private/var), so compare against the resolved directory.
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	team := filepath.Join(base, "team-a")
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
	found := discoverRepositories(teamDir(t))

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

	if found := discoverRepositories(repo); len(found) != 0 {
		t.Fatalf("a repository was split: %v", discoveredPaths(found))
	}
}

func TestDiscoveredKeysAreUnique(t *testing.T) {
	team := filepath.Join(t.TempDir(), "svc")
	touch(t, team, "x/svc/go.mod", "y/svc/go.mod", "z/svc/go.mod")

	roots := rootsFor(team, discoverRepositories(team))

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

	p, err := m.Add("", team)
	if err != nil {
		t.Fatal(err)
	}

	if p.ID != projectID(rootsFor(team, nil)) || p.Directory != team {
		t.Fatalf("project = %+v", p)
	}

	var roots []string
	for _, r := range p.Roots {
		roots = append(roots, r.Key+"="+r.Root)
	}

	want := []string{
		"team-a=" + team,
		"api=" + filepath.Join(team, "api"),
		"storage=" + filepath.Join(team, "storage"),
		"b=" + filepath.Join(team, "tools/b"),
		"web=" + filepath.Join(team, "web"),
	}
	if !reflect.DeepEqual(roots, want) {
		t.Fatalf("roots = %v", roots)
	}
}

func TestStartupSplitsAnExistingProjectWithoutChangingItsID(t *testing.T) {
	m, home := setup(t)
	team := teamDir(t)

	legacy := Project{ID: projectID(rootsFor(team, nil)), Name: "Team A", Roots: rootsFor(team, nil)}
	if _, err := m.addProject(legacy); err != nil {
		t.Fatal(err)
	}

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()

	got, ok := restored.project(legacy.ID)
	if !ok || len(got.Roots) != 5 || got.Directory != team || got.Name != "Team A" {
		t.Fatalf("restored = %+v", got)
	}
}

func TestStartupLeavesFixedMultiRootWorkspacesAlone(t *testing.T) {
	m, home := setup(t)
	a, b := teamDir(t), t.TempDir()

	fixed := Project{ID: projectID(rootsFor(a, nil)), Name: "Existing workspace", Roots: append(rootsFor(a, nil), rootsFor(b, nil)...)}
	if _, err := m.addProject(fixed); err != nil {
		t.Fatal(err)
	}

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()

	if got, _ := restored.project(fixed.ID); !reflect.DeepEqual(got.Roots, fixed.Roots) {
		t.Fatalf("fixed roots changed: %+v", got.Roots)
	}
}

func TestStartupPicksUpNewRepositories(t *testing.T) {
	m, home := setup(t)
	team := teamDir(t)

	p, err := m.Add("", team)
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

func TestStartupLeavesTheConfiguredStartupRootAlone(t *testing.T) {
	m, home := setup(t)
	startup := m.base.Roots[0].Root
	touch(t, startup, "api/.git/HEAD")

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()

	got, _ := restored.project(restored.catalog.LegacyID)
	if len(got.Roots) != 1 || got.Roots[0].Key != "original" || got.Directory != "" {
		t.Fatalf("startup project changed: %+v", got)
	}
}

func TestStartupKeepsAProjectsDirectoryKey(t *testing.T) {
	m, home := setup(t)
	team := teamDir(t)

	legacy := Project{ID: projectID(rootsFor(team, nil)), Name: "Team A", Roots: []domain.Repo{{Key: "team", Root: team}}}
	if _, err := m.addProject(legacy); err != nil {
		t.Fatal(err)
	}

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()

	if got, _ := restored.project(legacy.ID); got.Roots[0].Key != "team" || len(got.Roots) != 5 {
		t.Fatalf("roots = %+v", got.Roots)
	}
}

func TestStartupKeepsRepositoriesWhenTheDirectoryIsUnavailable(t *testing.T) {
	m, home := setup(t)
	team := teamDir(t)

	p, err := m.Add("", team)
	if err != nil {
		t.Fatal(err)
	}

	moved := team + "-unmounted"
	if err := os.Rename(team, moved); err != nil {
		t.Fatal(err)
	}

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()

	if got, _ := restored.project(p.ID); !reflect.DeepEqual(got.Roots, p.Roots) {
		t.Fatalf("roots collapsed while the directory was missing: %+v", got.Roots)
	}
}
