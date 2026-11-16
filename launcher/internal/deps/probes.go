package deps

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// OnnxPresent reports whether the ONNX Runtime C headers are installed where
// core/CMakeLists.txt looks for them — i.e. whether a build will enable
// embedding. It mirrors that file's search paths so doctor and the build agree.
func OnnxPresent() bool {
	hints := []string{
		os.Getenv("ONNXRUNTIME_ROOT"),
		"/opt/homebrew/opt/onnxruntime",
		"/usr/local",
		"/opt/homebrew",
		"/usr",
	}
	for _, h := range hints {
		if h == "" {
			continue
		}
		for _, suffix := range []string{"include/onnxruntime", "include"} {
			if fileExists(filepath.Join(h, suffix, "onnxruntime_c_api.h")) {
				return true
			}
		}
	}
	return false
}

func hasBin(name string) func() bool {
	return func() bool { _, err := exec.LookPath(name); return err == nil }
}

func hasSupportedNode() bool {
	node, err := exec.LookPath("node")
	return err == nil && CheckNode(node) == nil
}

// CheckNode verifies the executable that will actually run the agent. Merely
// finding `node` on PATH is insufficient: older Nodes start the web server but
// ai-sdk's timed first request then crashes at AbortSignal.any.
func CheckNode(node string) error {
	output, err := exec.Command(node, "-p", "process.versions.node + ' ' + (typeof AbortSignal === 'undefined' ? 'undefined' : typeof AbortSignal.any)").Output()
	if err != nil {
		return fmt.Errorf("cannot check Node.js runtime at %s: %w", node, err)
	}
	fields := strings.Fields(string(output))
	if len(fields) != 2 {
		return fmt.Errorf("cannot determine Node.js version and AbortSignal.any support at %s", node)
	}
	major, err := strconv.Atoi(strings.SplitN(fields[0], ".", 2)[0])
	if err != nil {
		return fmt.Errorf("invalid Node.js version %q at %s", fields[0], node)
	}
	if major < 22 {
		return fmt.Errorf("Codeberg requires Node.js 22 or newer; found %s at %s. Upgrade Node.js and ensure `node --version` reports 22+ on PATH", fields[0], node)
	}
	if fields[1] != "function" {
		return fmt.Errorf("Node.js %s at %s lacks AbortSignal.any, required by the agent. Use a standard Node.js 22+ runtime", fields[0], node)
	}
	return nil
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func truthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
