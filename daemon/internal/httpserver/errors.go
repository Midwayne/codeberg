package httpserver

import (
	"errors"
	"net/http"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/subprocess"
	"codeberg.org/codeberg/daemon/internal/tools"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func statusFor(err error) int {
	var ie *indexctl.IndexerError
	if errors.As(err, &ie) {
		switch ie.Code {
		case "NOT_IMPLEMENTED":
			return http.StatusNotImplemented
		case "NOT_FOUND":
			return http.StatusNotFound
		case "INVALID_ARGUMENT":
			return http.StatusBadRequest
		case "NOT_READY":
			return http.StatusServiceUnavailable
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
	case errors.Is(err, subprocess.ErrInvalid), errors.Is(err, subprocess.ErrUnsafe), errors.Is(err, subprocess.ErrUnsafeSed):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func codeFor(err error, status int) string {
	var ie *indexctl.IndexerError
	if errors.As(err, &ie) && ie.Code != "" {
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
	case http.StatusServiceUnavailable:
		return "NOT_READY"
	default:
		return "INTERNAL"
	}
}
