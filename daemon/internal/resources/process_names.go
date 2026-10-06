package resources

import (
	"path/filepath"
	"regexp"
	"strings"
)

var pythonProcess = regexp.MustCompile(`^python(\d+(\.\d+)*)?$`)

// Only fixed component labels leave the collector; command arguments stay local.
func workerName(command, arguments, model, backend string) string {
	path := filepath.ToSlash(command)
	embedding := strings.Contains(path, "/embedding-venv/")
	search := strings.Contains(path, "/searxng/venv/")
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

	switch backend {
	case "mlx":
		details = append(details, "MLX")
	case "llama":
		details = append(details, "llama.cpp")
	}

	if len(details) == 0 {
		return "Embedding worker"
	}
	return "Embedding worker — " + strings.Join(details, "/")
}
