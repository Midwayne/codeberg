package indexctl

import (
	"errors"
	"fmt"
	"net/http"
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

// HTTPStatus maps indexer errors to HTTP status codes.
func HTTPStatus(err error) int {
	var ie *IndexerError
	if errors.As(err, &ie) {
		switch ie.Code {
		case "NOT_IMPLEMENTED":
			return http.StatusNotImplemented
		case "NOT_FOUND":
			return http.StatusNotFound
		case "INVALID_ARGUMENT":
			return http.StatusBadRequest
		case "TIMEOUT":
			return http.StatusGatewayTimeout
		default:
			return http.StatusServiceUnavailable
		}
	}
	if strings.Contains(err.Error(), "indexer connect:") {
		return http.StatusServiceUnavailable
	}
	return http.StatusServiceUnavailable
}
