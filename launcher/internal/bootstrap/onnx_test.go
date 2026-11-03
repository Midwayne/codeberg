package bootstrap

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
)

func writeCapabilityIndexer(t *testing.T, path, response string) {
	t.Helper()

	script := "#!/bin/sh\n[ \"$1\" = --capabilities ] || exit 1\n" + response + "\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func sourceFixture(t *testing.T) (*config.Config, config.Artifacts) {
	t.Helper()

	c := &config.Config{Repo: t.TempDir(), Home: t.TempDir()}
	a := config.LocateArtifacts(c.Repo)
	for _, path := range []string{a.DaemonBin, a.IndexBin, a.WebScript,
		filepath.Join(c.Repo, "agent", "web-ui", "dist", "index.html")} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}

		if err := os.WriteFile(path, nil, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	return c, a
}

func stubSourceBuild(t *testing.T, build func(string, string, string) error) *[]bool {
	t.Helper()

	originalDeps, originalBuild := ensureBuildDeps, buildComponent
	t.Cleanup(func() { ensureBuildDeps, buildComponent = originalDeps, originalBuild })
	var requests []bool
	ensureBuildDeps = func(_ io.Writer, onnx bool) error {
		requests = append(requests, onnx)

		return nil
	}
	buildComponent = build

	return &requests
}

func TestSourceLaunchRebuildsONNXAfterNoVectorBuild(t *testing.T) {
	for _, response := range []string{"printf '{\"onnx\":false}\\n'", "exit 1"} {
		t.Run(response, func(t *testing.T) {
			c, a := sourceFixture(t)
			writeCapabilityIndexer(t, a.IndexBin, response)
			var targets []string
			requests := stubSourceBuild(t, func(repo, target, _ string) error {
				if repo != c.Repo {
					t.Fatalf("build used a different source checkout: %s", repo)
				}

				targets = append(targets, target)
				writeCapabilityIndexer(t, a.IndexBin, "printf '{\"onnx\":true}\\n'")

				return nil
			})
			models := 0
			withPrepareModel(t, func(*config.Config, string) error {
				models++

				return nil
			})

			if err := Ensure(c, false); err != nil {
				t.Fatal(err)
			}

			if len(targets) != 0 || len(*requests) != 0 || models != 0 {
				t.Fatal("a no-vector launch must skip embedding prerequisites and setup")
			}

			c.Vector, c.EmbedBackend = true, "onnx"
			if err := Ensure(c, false); err != nil {
				t.Fatal(err)
			}

			if len(targets) != 1 || targets[0] != "build-daemon" || len(*requests) != 1 || !(*requests)[0] || models != 1 {
				t.Fatalf("ONNX was not restored: targets=%v prerequisites=%v model setups=%d", targets, *requests, models)
			}

			if err := Ensure(c, false); err != nil {
				t.Fatal(err)
			}

			if len(targets) != 1 || len(*requests) != 1 {
				t.Fatal("an ONNX-capable binary must be reused on subsequent launches")
			}
		})
	}
}

func TestSourceLaunchHandlesUnavailableONNXAfterRebuild(t *testing.T) {
	for _, force := range []bool{false, true} {
		t.Run(map[bool]string{false: "run", true: "build"}[force], func(t *testing.T) {
			c, a := sourceFixture(t)
			c.Vector, c.EmbedBackend = true, "onnx"
			writeCapabilityIndexer(t, a.IndexBin, "printf '{\"onnx\":false}\\n'")
			stubSourceBuild(t, func(string, string, string) error { return nil })
			withPrepareModel(t, func(*config.Config, string) error {
				t.Fatal("weights must not be downloaded without an ONNX-capable indexer")

				return nil
			})

			var err error
			out := captureStderr(t, func() { err = Ensure(c, force) })
			if force {
				if err == nil || !strings.Contains(err.Error(), "ONNX") || !c.Vector {
					t.Fatalf("explicit build must report the missing runtime: %v", err)
				}
			} else if err != nil || c.Vector || !strings.Contains(out, "ONNX") {
				t.Fatalf("normal startup must continue without embeddings: err=%v vector=%v output=%s", err, c.Vector, out)
			}
		})
	}
}

func TestWorkerEmbeddingDoesNotProbeONNX(t *testing.T) {
	c, a := sourceFixture(t)
	c.Vector, c.EmbedBackend = true, "sentence-transformers"
	writeCapabilityIndexer(t, a.IndexBin, "exit 1")
	requests := stubSourceBuild(t, func(string, string, string) error {
		t.Fatal("worker embeddings must reuse the existing indexer")

		return nil
	})
	withPrepareModel(t, func(*config.Config, string) error { return nil })

	if err := Ensure(c, false); err != nil || len(*requests) != 0 {
		t.Fatalf("worker embeddings unexpectedly checked ONNX: err=%v prerequisites=%v", err, *requests)
	}
}
