package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDecisionCredentialsReachAgentFromConfig(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, "config")
	keys := []string{"TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "CLOUDFLARE_API_TOKEN"}
	for _, key := range keys {
		t.Setenv(key, "")
	}

	content := "TYPESAFE_API_KEY=typesafe-test\nOPENROUTER_API_KEY=router-test\nCLOUDFLARE_API_TOKEN=cloudflare-test\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}

	c, err := Load(Overrides{Home: home, ConfigFile: path})
	if err != nil {
		t.Fatal(err)
	}

	for _, key := range keys {
		if !IsKnownKey(key) || c.AgentEnv()[key] == "" {
			t.Errorf("decision credential %s must reach the agent", key)
		}

		if c.DaemonEnv()[key] != "" {
			t.Errorf("decision credential %s must not appear in daemon config", key)
		}
	}
}
