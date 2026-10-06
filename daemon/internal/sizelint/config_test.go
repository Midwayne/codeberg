package sizelint

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLimits(t *testing.T) {
	for _, fixture := range []struct {
		name, source string
		valid        bool
	}{
		{"valid", `{"maxFileLines":199,"maxFunctionLines":50}`, true},
		{"zero", `{"maxFileLines":0,"maxFunctionLines":50}`, false},
		{"negative", `{"maxFileLines":199,"maxFunctionLines":-1}`, false},
		{"missing", `{"maxFileLines":199}`, false},
		{"unknown", `{"maxFileLines":199,"maxFunctionLines":50,"typo":true}`, false},
		{"malformed", `{`, false},
		{"trailing", `{"maxFileLines":199,"maxFunctionLines":50} {}`, false},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "limits.json")
			if err := os.WriteFile(path, []byte(fixture.source), 0600); err != nil {
				t.Fatal(err)
			}

			limits, err := LoadLimits(path)
			if (err == nil) != fixture.valid {
				t.Fatalf("got limits %v, error %v", limits, err)
			}

			if fixture.valid && limits != testLimits {
				t.Fatalf("unexpected limits: %v", limits)
			}
		})
	}
}

func TestCommittedLimits(t *testing.T) {
	limits, err := LoadLimits(filepath.Join("..", "..", ".lint.json"))
	if err != nil || limits != testLimits {
		t.Fatalf("expected agent-equivalent limits: %v, %v", limits, err)
	}

	if _, err := LoadLimits(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("missing config should fail")
	}
}
