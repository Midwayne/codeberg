package indexctl

import (
	"errors"
	"fmt"
)

// ErrTruncated accompanies usable graph references when IPC clipped the response.
var ErrTruncated = errors.New("indexer: graph references truncated")

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

// daemonCode maps a cberg-index wire code onto the daemon's error code.
// Unrecognized codes, including a missing code, stay INDEXER_ERROR. The
// English error text is not consulted.
func daemonCode(wire string) string {
	switch wire {
	case "not_ready":
		return "NOT_READY"
	case "not_implemented":
		return "NOT_IMPLEMENTED"
	case "not_found":
		return "NOT_FOUND"
	case "invalid_argument":
		return "INVALID_ARGUMENT"
	case "internal_error":
		return "INTERNAL_ERROR"
	case "io_error":
		return "IO_ERROR"
	case "out_of_memory":
		return "OUT_OF_MEMORY"
	case "timeout":
		return "TIMEOUT"
	case "unsupported_language":
		return "UNSUPPORTED_LANGUAGE"
	case "corrupt":
		return "CORRUPT"
	default:
		return "INDEXER_ERROR"
	}
}

func mapIndexerError(wire, message string) error {
	return &IndexerError{Code: daemonCode(wire), Message: message}
}

// AsIndexerError returns the IndexerError if err wraps one.
func AsIndexerError(err error) (*IndexerError, bool) {
	var ie *IndexerError
	ok := errors.As(err, &ie)
	return ie, ok
}
