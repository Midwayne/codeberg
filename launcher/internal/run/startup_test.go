package run

import (
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/registry"
)

func TestStartupLabelNamesTheRootsBeingIndexed(t *testing.T) {
	cases := []struct {
		name  string
		roots []registry.Entry
		want  string
	}{
		{"catalog only", nil, "Starting Codeberg"},
		{"one root", []registry.Entry{{Key: "core"}}, "Starting Codeberg and indexing core"},
		{"several roots", []registry.Entry{{Key: "core"}, {Key: "api"}}, "Starting Codeberg and indexing core, api"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := startupLabel(&config.Config{Roots: tc.roots}); got != tc.want {
				t.Fatalf("startupLabel = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestReadyMessageShowsOnlyTheBrowserURL(t *testing.T) {
	want := "✓ Ready at http://127.0.0.1:48088\n  Opening your browser. Press Ctrl-C to stop.\n\n"

	if got := readyMessage("http://127.0.0.1:48088"); got != want {
		t.Fatalf("readyMessage = %q, want %q", got, want)
	}
}
