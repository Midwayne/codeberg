package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScriptUseDefaultsOff(t *testing.T) {
	t.Setenv(KeyScriptUse, "")
	t.Setenv(KeyScriptPython, "")
	t.Setenv(KeyScriptMcp, "")

	c, err := Load(Overrides{Home: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	if c.ScriptUse {
		t.Fatal("ScriptUse should default to false")
	}

	env := c.AgentEnv()
	if env[KeyScriptUse] != "false" {
		t.Fatalf("AgentEnv[%s] = %q; want false", KeyScriptUse, env[KeyScriptUse])
	}

	if _, ok := env[KeyScriptPython]; ok {
		t.Fatal("AgentEnv should omit an empty CODEBERG_SCRIPT_PYTHON")
	}

	if _, ok := env[KeyScriptMcp]; ok {
		t.Fatal("AgentEnv should omit an empty CODEBERG_SCRIPT_MCP")
	}
}

func TestScriptSettingsFromConfigFileReachAgent(t *testing.T) {
	t.Setenv(KeyScriptUse, "")
	t.Setenv(KeyScriptPython, "")
	t.Setenv(KeyScriptMcp, "")

	home := t.TempDir()
	body := "CODEBERG_SCRIPT_USE=true\nCODEBERG_SCRIPT_PYTHON=/opt/py/bin/python3\nCODEBERG_SCRIPT_MCP=jira,databases\n"
	if err := os.WriteFile(filepath.Join(home, "config"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	c, err := Load(Overrides{Home: home})
	if err != nil {
		t.Fatal(err)
	}

	env := c.AgentEnv()
	if env[KeyScriptUse] != "true" {
		t.Fatalf("AgentEnv[%s] = %q; want true", KeyScriptUse, env[KeyScriptUse])
	}

	if env[KeyScriptPython] != "/opt/py/bin/python3" {
		t.Fatalf("AgentEnv[%s] = %q", KeyScriptPython, env[KeyScriptPython])
	}

	if env[KeyScriptMcp] != "jira,databases" {
		t.Fatalf("AgentEnv[%s] = %q", KeyScriptMcp, env[KeyScriptMcp])
	}

	if !IsKnownKey(KeyScriptUse) || !IsKnownKey(KeyScriptPython) || !IsKnownKey(KeyScriptMcp) {
		t.Fatal("script keys should be known config keys")
	}
}
