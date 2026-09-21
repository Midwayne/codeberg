package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/launcher/internal/registry"
)

func TestMcpUseDefaultsOnAndPropagatesToAgent(t *testing.T) {
	t.Setenv("CODEBERG_MCP_USE", "")
	t.Setenv("CODEBERG_MCP_CONFIG", "")
	home := t.TempDir()
	c, err := Load(Overrides{Home: home})
	if err != nil {
		t.Fatal(err)
	}
	if !c.McpUse {
		t.Fatal("McpUse should default to true")
	}
	env := c.AgentEnv()
	if env[KeyMcpUse] != "true" {
		t.Fatalf("AgentEnv[%s] = %q; want true", KeyMcpUse, env[KeyMcpUse])
	}
	if env[KeyHome] != home {
		t.Fatalf("AgentEnv[%s] = %q; want %q", KeyHome, env[KeyHome], home)
	}
	if _, ok := env[KeyMcpConfig]; ok {
		t.Fatal("AgentEnv should omit empty CODEBERG_MCP_CONFIG")
	}
}

func TestMcpUseDisabledViaEnv(t *testing.T) {
	t.Setenv("CODEBERG_MCP_USE", "false")
	c, err := Load(Overrides{Home: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if c.McpUse {
		t.Fatal("McpUse should be false when CODEBERG_MCP_USE=false")
	}
	if got := c.AgentEnv()[KeyMcpUse]; got != "false" {
		t.Fatalf("AgentEnv[%s] = %q; want false", KeyMcpUse, got)
	}
}

func TestAgentEnvPropagatesRootsAndMcpConfig(t *testing.T) {
	c := &Config{
		Home:      "/home/me/.codeberg",
		Root:      "/one",
		HTTPPort:  "48080",
		Model:     "anthropic:claude",
		DaemonURL: "http://127.0.0.1:48080",
		McpUse:    true,
		McpConfig: "/extra/mcp.json",
		Roots:     []registry.Entry{{Key: "alpha", Root: "/one"}, {Key: "beta", Root: "/two"}},
		All:       true,
	}
	e := c.AgentEnv()
	if e[KeyRoots] != "alpha\t/one\nbeta\t/two" {
		t.Fatalf("roots env: got %q", e[KeyRoots])
	}
	if _, ok := e[KeyRoot]; ok {
		t.Fatal("--all must not pin CODEBERG_ROOT on the agent")
	}
	if e[KeyMcpConfig] != "/extra/mcp.json" {
		t.Fatalf("mcp config: %q", e[KeyMcpConfig])
	}
}

func TestInitMcpFileWritesEmptyServers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mcp.json")
	created, err := InitMcpFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("InitMcpFile should create a new file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	body := string(data)
	if !strings.Contains(body, `"mcpServers"`) {
		t.Fatalf("starter mcp.json missing mcpServers: %s", body)
	}
	again, err := InitMcpFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if again {
		t.Fatal("InitMcpFile must not overwrite an existing file")
	}
}
