package supervisor

import (
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/domain"
)

func TestIndexerEnvForwardsIndexQuant(t *testing.T) {
	cfg := config.Indexer{
		Root:         "/tmp/repo",
		Roots:        []domain.Repo{{Key: "repo", Root: "/tmp/repo"}},
		DefaultKey:   "repo",
		Model:        "models/model.onnx",
		Index:        "/tmp/index.usearch",
		IndexBackend: "usearch",
		IndexQuant:   "f32",
		PollMS:       1000,
		Socket:       "/tmp/codeberg-index.sock",
	}

	env := indexerEnv(cfg)
	if !hasEnv(env, config.EnvIndexQuant+"=f32") {
		t.Fatalf("expected %s forwarded, got %v", config.EnvIndexQuant, env)
	}
}

func TestIndexerEnvOmitsEmptyIndexQuant(t *testing.T) {
	cfg := config.Indexer{
		Root:       "/tmp/repo",
		Roots:      []domain.Repo{{Key: "repo", Root: "/tmp/repo"}},
		DefaultKey: "repo",
		PollMS:     1000,
		Socket:     "/tmp/codeberg-index.sock",
	}

	env := indexerEnv(cfg)
	if hasEnvPrefix(env, config.EnvIndexQuant+"=") {
		t.Fatalf("did not expect %s when unset, got %v", config.EnvIndexQuant, env)
	}
}

func hasEnv(env []string, want string) bool {
	for _, e := range env {
		if e == want {
			return true
		}
	}
	return false
}

func hasEnvPrefix(env []string, prefix string) bool {
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return true
		}
	}
	return false
}
