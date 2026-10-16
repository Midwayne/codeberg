package indexctl

import "testing"

func TestBuildingErrorSuggestsFilesystemTools(t *testing.T) {
	err := mapIndexerError("index building; use grep, glob or read_file while indexing and graph creation finish")
	ie, ok := AsIndexerError(err)
	if !ok || ie.Code != "NOT_READY" {
		t.Fatalf("building error = %v", err)
	}
}
