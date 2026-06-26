package uninstall

import (
	"os"
	"path/filepath"
	"testing"
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
