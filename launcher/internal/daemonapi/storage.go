// Package daemonapi asks codeberg-d for state the daemon owns.
package daemonapi

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"codeberg.org/codeberg/launcher/internal/config"
)

// IndexSet is one indexed root's cached files, as printed by `codeberg-d storage`.
type IndexSet struct {
	Name  string   `json:"name"`
	Files []string `json:"files"`
}

// Report is the layout `codeberg-d storage` prints.
type Report struct {
	Home      string     `json:"home"`
	Owned     []string   `json:"owned"`
	IndexSets []IndexSet `json:"indexSets"`
}

// Binary is the codeberg-d next to the other artifacts under root.
func Binary(root string) string {
	if root == "" {
		return ""
	}

	return config.LocateArtifacts(root).DaemonBin
}

// Storage runs `codeberg-d storage` for home.
func Storage(bin, home string) (Report, error) {
	if bin == "" {
		return Report{}, fmt.Errorf("codeberg-d is not available")
	}

	cmd := exec.Command(bin, "storage")
	cmd.Env = withoutKey(os.Environ(), "CODEBERG_HOME")
	cmd.Env = append(cmd.Env, "CODEBERG_HOME="+home)
	out, err := cmd.Output()
	if err != nil {
		return Report{}, fmt.Errorf("codeberg-d storage: %w", err)
	}

	var report Report
	if err := json.Unmarshal(out, &report); err != nil {
		return Report{}, fmt.Errorf("codeberg-d storage: %w", err)
	}

	return report, nil
}

func withoutKey(env []string, key string) []string {
	prefix := key + "="
	out := make([]string, 0, len(env))

	for _, entry := range env {
		if !strings.HasPrefix(entry, prefix) {
			out = append(out, entry)
		}
	}

	return out
}
