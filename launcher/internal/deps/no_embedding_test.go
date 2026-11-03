package deps

import "testing"

func TestNoEmbeddingBuildSkipsONNXPrerequisite(t *testing.T) {
	for _, r := range requirements(false) {
		if r.label == "onnxruntime" {
			t.Fatal("disabled embeddings must not install ONNX Runtime")
		}
	}

	for _, r := range requirements(true) {
		if r.label == "onnxruntime" {
			return
		}
	}

	t.Fatal("ONNX builds must keep the runtime prerequisite")
}
