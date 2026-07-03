package deps

import (
	"os"
	"path/filepath"
	"testing"
)

// fakeInterpreter writes a shell script masquerading as a python3 binary: `-m
// pip --version` exits 0 when pipWorks, nonzero otherwise (mirroring the real
// "ensurepip has no bundled wheels" failure on a bare Debian python3).
func fakeInterpreter(t *testing.T, pipWorks bool) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "python3")
	exit := "0"
	if !pipWorks {
		exit = "1"
	}
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = \"-m\" ] && [ \"$2\" = \"pip\" ]; then exit " + exit + "; fi\n" +
		"exit 0\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestHasPip(t *testing.T) {
	if !hasPip(fakeInterpreter(t, true)) {
		t.Fatal("expected hasPip to detect a working pip")
	}
	if hasPip(fakeInterpreter(t, false)) {
		t.Fatal("expected hasPip to detect a broken/missing pip")
	}
}

func TestPythonBinFindsOnPath(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "python3")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	got, ok := pythonBin()
	if !ok || got != path {
		t.Fatalf("pythonBin() = %q, %v; want %q, true", got, ok, path)
	}
}

func TestPythonBinMissing(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, ok := pythonBin(); ok {
		t.Fatal("expected no python found on an empty PATH")
	}
}
