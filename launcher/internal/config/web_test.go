package config

import "testing"

func TestWebUseDefaultsOnAndPropagatesToAgent(t *testing.T) {
	t.Setenv("CODEBERG_WEB_USE", "")
	t.Setenv("CODEBERG_SEARXNG_URL", "")
	c, err := Load(Overrides{Home: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if !c.WebUse {
		t.Fatal("WebUse should default to true")
	}
	if c.SearxngPort != DefaultSearxngPort {
		t.Fatalf("SearxngPort = %q; want %q", c.SearxngPort, DefaultSearxngPort)
	}
	env := c.AgentEnv()
	if env[KeyWebUse] != "true" {
		t.Fatalf("AgentEnv[%s] = %q; want true", KeyWebUse, env[KeyWebUse])
	}
	if v, ok := env[KeySearxngURL]; ok {
		t.Fatalf("AgentEnv should carry no external SearXNG URL by default, got %q", v)
	}
}

func TestWebUseDisabledViaEnv(t *testing.T) {
	t.Setenv("CODEBERG_WEB_USE", "false")
	c, err := Load(Overrides{Home: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if c.WebUse {
		t.Fatal("WebUse should be false when CODEBERG_WEB_USE=false")
	}
	if got := c.AgentEnv()[KeyWebUse]; got != "false" {
		t.Fatalf("AgentEnv[%s] = %q; want false", KeyWebUse, got)
	}
}

func TestExternalSearxngURLPropagates(t *testing.T) {
	t.Setenv("CODEBERG_WEB_USE", "")
	t.Setenv("CODEBERG_SEARXNG_URL", "http://127.0.0.1:8888")
	c, err := Load(Overrides{Home: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if c.SearxngURL != "http://127.0.0.1:8888" {
		t.Fatalf("SearxngURL = %q", c.SearxngURL)
	}
	if got := c.AgentEnv()[KeySearxngURL]; got != "http://127.0.0.1:8888" {
		t.Fatalf("AgentEnv[%s] = %q; want the external URL", KeySearxngURL, got)
	}
}
