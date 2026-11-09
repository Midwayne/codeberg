package uninstall

import (
	"os"
	"path/filepath"
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
)

// commandDirs must scan the live $PATH so uninstall finds a `codeberg` wherever
// it was installed. The bug this guards against was a hardcoded directory list
// that missed any other PATH location (e.g. /opt/homebrew/bin or a custom dir),
// so `codeberg uninstall` left the command in place.
func TestCommandDirsIncludesPathEntries(t *testing.T) {
	custom := t.TempDir()
	t.Setenv("PATH", custom+string(os.PathListSeparator)+filepath.Join("/usr", "bin"))

	dirs := commandDirs()
	for _, d := range dirs {
		if d == custom {
			return
		}
	}
	t.Fatalf("commandDirs() = %v; want it to include the PATH entry %q", dirs, custom)
}

func TestManagedDataUsesTheDaemonStorageReport(t *testing.T) {
	home := t.TempDir()
	dist := t.TempDir()
	project := filepath.Join(home, "projects")
	if err := os.MkdirAll(project, 0700); err != nil {
		t.Fatal(err)
	}

	binDir := filepath.Join(dist, "core", "build", "bin")
	web := filepath.Join(dist, "agent", "dist", "web.js")
	if err := os.MkdirAll(binDir, 0755); err != nil || os.MkdirAll(filepath.Dir(web), 0755) != nil {
		t.Fatal(err)
	}

	script := "#!/bin/sh\nprintf '%s\\n' \"{\\\"owned\\\":[\\\"$CODEBERG_HOME/projects\\\"],\\\"indexSets\\\":[]}\"\n"
	for _, path := range []string{filepath.Join(binDir, "codeberg-d"), filepath.Join(binDir, "cberg-index"), web} {
		if err := os.WriteFile(path, []byte(script), 0755); err != nil {
			t.Fatal(err)
		}
	}

	c := &config.Config{Home: home, Dist: dist, ConfigPath: filepath.Join(home, "config")}
	got, note := managedData(c)
	if note != "" {
		t.Fatal(note)
	}

	found := false
	for _, path := range got {
		if path == project {
			found = true
		}
	}

	if !found {
		t.Fatalf("daemon-owned projects dir missing from %v", got)
	}
}
