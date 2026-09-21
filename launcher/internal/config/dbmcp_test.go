package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDbmcpUseDefaultsOff(t *testing.T) {
	t.Setenv(KeyDbmcpUse, "")
	t.Setenv(KeyDbmcpSpec, "")
	t.Setenv(KeyDbmcpBin, "")
	home := t.TempDir()
	c, err := Load(Overrides{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	if c.DbmcpUse {
		t.Fatal("DbmcpUse should default to false")
	}
	env := c.AgentEnv()
	if env[KeyDbmcpUse] != "false" {
		t.Fatalf("AgentEnv[%s] = %q; want false", KeyDbmcpUse, env[KeyDbmcpUse])
	}
	if _, ok := env[KeyDbmcpBin]; ok {
		t.Fatal("AgentEnv should omit CODEBERG_DBMCP_BIN when the feature is off")
	}
	if _, ok := env[KeyDbmcpSpec]; ok {
		t.Fatal("AgentEnv should omit an empty CODEBERG_DBMCP_SPEC")
	}
}

func TestDbmcpUseEnabledPropagatesBinary(t *testing.T) {
	t.Setenv(KeyDbmcpUse, "true")
	t.Setenv(KeyDbmcpSpec, "")
	t.Setenv(KeyDbmcpBin, "")
	home := t.TempDir()
	c, err := Load(Overrides{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	if !c.DbmcpUse {
		t.Fatal("CODEBERG_DBMCP_USE=true should enable DbmcpUse")
	}
	env := c.AgentEnv()
	if env[KeyDbmcpUse] != "true" {
		t.Fatalf("AgentEnv[%s] = %q; want true", KeyDbmcpUse, env[KeyDbmcpUse])
	}
	if c.Repo == "" {
		t.Fatal("expected FindRepo to locate this checkout")
	}
	want := LocateArtifacts(c.Repo).DbmcpBin
	if env[KeyDbmcpBin] != want {
		t.Fatalf("AgentEnv[%s] = %q; want %q", KeyDbmcpBin, env[KeyDbmcpBin], want)
	}

	spec := filepath.Join(home, "spec.yml")
	if err := os.WriteFile(spec, []byte("connections: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, found := c.DbmcpSpecFile()
	if !found || got != spec {
		t.Fatalf("DbmcpSpecFile() = (%q, %v); want (%q, true)", got, found, spec)
	}
}

func TestDbmcpSpecOverrideAndExplicitBinary(t *testing.T) {
	home := t.TempDir()
	spec := filepath.Join(home, "custom.yml")
	if err := os.WriteFile(spec, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(KeyDbmcpUse, "yes")
	t.Setenv(KeyDbmcpSpec, spec)
	t.Setenv(KeyDbmcpBin, "/opt/dbmcp")
	c, err := Load(Overrides{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	env := c.AgentEnv()
	if env[KeyDbmcpSpec] != spec {
		t.Fatalf("spec = %q", env[KeyDbmcpSpec])
	}
	if env[KeyDbmcpBin] != "/opt/dbmcp" {
		t.Fatalf("bin = %q", env[KeyDbmcpBin])
	}
	if got, found := c.DbmcpSpecFile(); !found || got != spec {
		t.Fatalf("DbmcpSpecFile() = (%q, %v)", got, found)
	}
	if !IsKnownKey(KeyDbmcpUse) || !IsKnownKey(KeyDbmcpSpec) || !IsKnownKey(KeyDbmcpBin) {
		t.Fatal("database MCP keys should be known config keys")
	}
}
