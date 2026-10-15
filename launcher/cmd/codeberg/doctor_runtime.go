package main

import (
	"fmt"
	"os/exec"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/deps"
)

func reportRuntime(c *config.Config) {
	if _, prebuilt := c.ResolveRoot(); prebuilt {
		fmt.Println("Prebuilt runtime (build tools are not required):")
		node, err := c.NodeBinary()
		if err != nil {
			fmt.Println("  ✘ Node runtime missing — reinstall the release")
		} else if err := deps.CheckNode(node); err != nil {
			fmt.Printf("  ✘ %v\n", err)
		} else {
			fmt.Printf("  ✓ node %s\n", node)
		}

		return
	}

	fmt.Println("Toolchains:")
	for _, tool := range []string{"go", "node", "npm", "make", "cmake", "git"} {
		if path, err := exec.LookPath(tool); err == nil {
			fmt.Printf("  ✓ %-12s %s\n", tool, path)
		} else {
			fmt.Printf("  ✘ %-12s not found — `codeberg build` auto-installs it (brew/apt)\n", tool)
		}
	}

	if deps.OnnxPresent() {
		fmt.Println("  ✓ onnxruntime installed (vector embeddings available)")
	} else {
		fmt.Println("  • onnxruntime not found — needed only for ONNX embedding models")
	}
}
