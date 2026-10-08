package supervisor

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/domain"
)

func TestWipeUsesCoreNamespaceAndPreservesRuntimeEnvironment(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "indexer")
	seen := filepath.Join(dir, "seen")
	script := "#!/bin/sh\nprintf '%s\\n' \"$1\" \"$2\" \"$3\" \"$CODEBERG_ROOTS\" \"$CODEBERG_TEST_LOADER\" > '" + seen + "'\n"
	if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CODEBERG_TEST_LOADER", "preserve-library-path")
	t.Setenv("CODEBERG_ROOTS", "unrelated\t/unrelated")
	cfg := config.Indexer{Bin: bin, Index: filepath.Join(dir, "namespace"), Root: "/chosen", Roots: []domain.Repo{{Key: "chosen", Root: "/chosen"}}}

	if err := WipeIndex(context.Background(), cfg, "/chosen"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(seen)
	if err != nil {
		t.Fatal(err)
	}
	expected := strings.Join([]string{"--wipe-index", cfg.Index, "/chosen", "chosen\t/chosen", "preserve-library-path", ""}, "\n")
	if string(raw) != expected {
		t.Fatalf("wipe environment or namespace differs: %q", raw)
	}
}
