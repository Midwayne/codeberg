package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPackagedRuntimeWithoutSystemNode(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)
	bin := filepath.Join(dist, "runtime", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	node := filepath.Join(bin, "node")
	if err := os.WriteFile(node, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", "/no-system-node")
	c := &Config{Dist: dist}
	got, err := c.NodeBinary()
	if err != nil || got != node {
		t.Fatalf("NodeBinary() = %q, %v; want %q", got, err, node)
	}

	for _, env := range []map[string]string{c.AgentEnv(), c.DaemonEnv()} {
		if !strings.HasPrefix(env["PATH"], bin+string(os.PathListSeparator)) {
			t.Fatalf("child PATH does not prefer bundled tools: %q", env["PATH"])
		}
	}
}

func TestSourceRuntimeUsesSystemNode(t *testing.T) {
	bin := t.TempDir()
	node := filepath.Join(bin, "node")
	if err := os.WriteFile(node, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	c := &Config{Repo: t.TempDir()}
	got, err := c.NodeBinary()
	if err != nil || got != node {
		t.Fatalf("NodeBinary() = %q, %v; want %q", got, err, node)
	}
}
