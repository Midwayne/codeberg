package indexctl

import (
	"errors"
	"fmt"
	"strings"
)

// IndexerError is a structured error from the C indexer IPC layer.
type IndexerError struct {
	Code    string
	Message string
}

func (e *IndexerError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("indexer: %s (%s)", e.Message, e.Code)
	}
	return fmt.Sprintf("indexer: %s", e.Message)
}

func mapIndexerError(msg string) error {
	code := "INDEXER_ERROR"
	switch strings.ToLower(msg) {
	case "not implemented":
		code = "NOT_IMPLEMENTED"
	case "not found":
		code = "NOT_FOUND"
	case "invalid argument":
		code = "INVALID_ARGUMENT"
	case "internal error":
		code = "INTERNAL_ERROR"
	case "i/o error":
		code = "IO_ERROR"
	case "out of memory":
		code = "OUT_OF_MEMORY"
	case "timeout":
		code = "TIMEOUT"
	}

	return &IndexerError{Code: code, Message: msg}
}

// AsIndexerError returns the IndexerError if err wraps one.
func AsIndexerError(err error) (*IndexerError, bool) {
	var ie *IndexerError
	ok := errors.As(err, &ie)
	return ie, ok
}
