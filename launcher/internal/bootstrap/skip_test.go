package bootstrap

import (
	"io"
	"os"
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
)

func captureStderr(t *testing.T, fn func()) string {
	t.Helper()

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}

	original := os.Stderr
	os.Stderr = w
	defer func() { os.Stderr = original }()

	fn()
	w.Close()

	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}

	return string(out)
}

func TestSkipIsQuietUnlessVerbose(t *testing.T) {
	quiet := captureStderr(t, func() { skip(&config.Config{}, "agent") })
	if quiet != "" {
		t.Fatalf("normal startup printed %q", quiet)
	}

	verbose := captureStderr(t, func() { skip(&config.Config{Verbose: true}, "agent") })
	if verbose != "✓ agent already present\n" {
		t.Fatalf("verbose startup printed %q", verbose)
	}
}
