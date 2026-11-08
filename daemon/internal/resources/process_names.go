package resources

import (
	"path/filepath"
	"regexp"
	"strings"
)

var pythonProcess = regexp.MustCompile(`^python(\d+(\.\d+)*)?$`)

// embedder identifies the configured embedding worker without reading its
// arguments: its interpreter lives in the venv that holds EmbedPython.
type embedder struct {
	model, backend, python string
}

func (e embedder) runs(command string) bool {
	if e.python == "" {
		return false
	}

	venv := filepath.Dir(filepath.Dir(e.python))
	return strings.HasPrefix(command, venv+string(filepath.Separator))
}

// Only fixed component labels leave the collector; command arguments stay local.
func workerName(command, arguments string, e embedder) string {
	model, backend := e.model, e.backend
	embedding := e.runs(command)
	search := false
	fields := strings.Fields(arguments)

	for i, field := range fields {
		if field == "-m" && i+1 < len(fields) && fields[i+1] == "searx.webapp" {
			search = true
		}

		if filepath.Base(field) == "embedding_worker.py" {
			embedding = true
			if i+1 < len(fields) {
				backend = fields[i+1]
			}

			if i+2 < len(fields) {
				model = strings.Join(fields[i+2:], " ")
			}
		}
	}

	if search {
		return "Web search — SearXNG"
	}

	if !embedding {
		return processName(command)
	}

	return embeddingName(model, backend)
}

func embeddingName(model, backend string) string {
	lower := strings.ToLower(model)
	if backend == "" {
		if strings.HasSuffix(lower, "-mlx") || strings.Contains(lower, "-mlx/") {
			backend = "mlx"
		} else if strings.HasSuffix(lower, ".gguf") || strings.Contains(lower, "-llama") {
			backend = "llama"
		}
	}

	details := make([]string, 0, 2)
	if strings.Contains(lower, "qwen3") {
		details = append(details, "Qwen3")
	}
	if strings.Contains(lower, "embeddinggemma-2") {
		details = append(details, "EmbeddingGemma 2")
	}

	switch backend {
	case "mlx", "gemma-mlx":
		details = append(details, "MLX")
	case "llama":
		details = append(details, "llama.cpp")
	case "sentence-transformers":
		details = append(details, "Sentence Transformers")
	}

	if len(details) == 0 {
		return "Embedding worker"
	}
	return "Embedding worker — " + strings.Join(details, "/")
}
