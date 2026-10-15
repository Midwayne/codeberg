package config

import (
	"os"
	"os/exec"
	"path/filepath"
)

// NodeBinary prefers the shipped runtime, including when an older system Node
// is installed. Source checkouts retain their existing PATH-based behavior.
func (c *Config) NodeBinary() (string, error) {
	if bin := c.runtimeBin(); bin != "" {
		node := filepath.Join(bin, "node")
		if info, err := os.Stat(node); err == nil && info.Mode().IsRegular() {
			return node, nil
		}
	}

	return exec.LookPath("node")
}

func (c *Config) runtimeBin() string {
	root, prebuilt := c.ResolveRoot()
	if !prebuilt {
		return ""
	}

	bin := filepath.Join(root, "runtime", "bin")
	if info, err := os.Stat(bin); err == nil && info.IsDir() {
		return bin
	}

	return ""
}

func (c *Config) addRuntimePath(env map[string]string) {
	if bin := c.runtimeBin(); bin != "" {
		env["PATH"] = bin + string(os.PathListSeparator) + os.Getenv("PATH")
	}
}
