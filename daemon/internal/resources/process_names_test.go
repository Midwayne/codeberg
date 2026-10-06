package resources

import "testing"

func TestWorkerNames(t *testing.T) {
	tests := []struct {
		command, arguments, model, backend, expected string
	}{
		{"/home/user/.codeberg/embedding-venv/bin/python", "", "/models/qwen3-fp16-mlx", "mlx", "Embedding worker — Qwen3/MLX"},
		{"/home/user/.codeberg/searxng/venv/bin/python", "", "", "", "Web search — SearXNG"},
		{"python3", "python3 /app/scripts/embedding_worker.py mlx /models/qwen3-fp16-mlx", "", "", "Embedding worker — Qwen3/MLX"},
		{"python3", "python3 /app with spaces/embedding_worker.py mlx /models with spaces/qwen3-fp16-mlx", "", "", "Embedding worker — Qwen3/MLX"},
		{"python", "python -m searx.webapp", "", "", "Web search — SearXNG"},
		{"python", "python /app/embedding_worker.py llama /models/qwen3-llama/model.gguf", "", "", "Embedding worker — Qwen3/llama.cpp"},
		{"python", "python /app/custom.py", "", "", "python"},
		{"python3", "python3 /app/my_embedding_worker.py", "", "", "python3"},
	}

	for _, test := range tests {
		if got := workerName(test.command, test.arguments, test.model, test.backend); got != test.expected {
			t.Errorf("%s %s: got %q want %q", test.command, test.arguments, got, test.expected)
		}
	}
}
