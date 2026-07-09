package httpserver

import (
	"errors"
	"net/http"
	"testing"

	"codeberg.org/codeberg/daemon/internal/subprocess"
	"codeberg.org/codeberg/daemon/internal/tools"
)

func TestErrorMappingUnsafeAndInvalid(t *testing.T) {
	cases := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"unsafe pipe", tools.ErrUnsafePipe, http.StatusBadRequest, "UNSAFE_PIPE"},
		{"unsafe sed", tools.ErrUnsafeSed, http.StatusBadRequest, "UNSAFE_SED"},
		{"invalid pipeline", subprocess.ErrInvalid, http.StatusBadRequest, "INVALID_ARGS"},
		{"wrapped invalid", errors.Join(subprocess.ErrInvalid, errors.New("empty")), http.StatusBadRequest, "INVALID_ARGS"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := statusFor(tc.err); got != tc.status {
				t.Fatalf("status %d, want %d", got, tc.status)
			}
			if got := codeFor(tc.err, tc.status); got != tc.code {
				t.Fatalf("code %q, want %q", got, tc.code)
			}
		})
	}
}
