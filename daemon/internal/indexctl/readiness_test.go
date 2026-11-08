package indexctl

import "testing"

func TestBuildingErrorSuggestsFilesystemTools(t *testing.T) {
	err := mapIndexerError("not_ready", "index is building")
	ie, ok := AsIndexerError(err)
	if !ok || ie.Code != "NOT_READY" || ie.Message != "index is building" {
		t.Fatalf("building error = %v", err)
	}
}

func TestErrorCodeIgnoresEnglishText(t *testing.T) {
	err := mapIndexerError("", "not found")
	ie, ok := AsIndexerError(err)
	if !ok || ie.Code != "INDEXER_ERROR" {
		t.Fatalf("english text must not select a code: %v", err)
	}

	err = mapIndexerError("corrupt", "corrupt or incompatible index")
	ie, ok = AsIndexerError(err)
	if !ok || ie.Code != "CORRUPT" {
		t.Fatalf("corrupt wire code = %v", err)
	}
}
