package httpserver

import (
	"errors"
	"net/http"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/tools"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func statusFor(err error) int {
	if ie, ok := indexctl.AsIndexerError(err); ok {
		switch ie.Code {
		case "NOT_IMPLEMENTED":
			return http.StatusNotImplemented
		case "NOT_FOUND":
			return http.StatusNotFound
		case "INVALID_ARGUMENT":
			return http.StatusBadRequest
		default:
			return http.StatusInternalServerError
		}
	}

	switch {
	case errors.Is(err, tools.ErrUnknownTool), errors.Is(err, workspace.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, workspace.ErrEscape):
		return http.StatusForbidden
	case errors.Is(err, tools.ErrInvalidArgs), errors.Is(err, tools.ErrUnsafeSed), errors.Is(err, tools.ErrUnsafePipe):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func codeFor(err error, status int) string {
	if ie, ok := indexctl.AsIndexerError(err); ok && ie.Code != "" {
		return ie.Code
	}

	switch status {
	case http.StatusNotFound:
		return "NOT_FOUND"
	case http.StatusForbidden:
		return "FORBIDDEN"
	case http.StatusBadRequest:
		return "INVALID_ARGS"
	case http.StatusNotImplemented:
		return "NOT_IMPLEMENTED"
	default:
		return "INTERNAL"
	}
}
