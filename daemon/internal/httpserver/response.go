package httpserver

import (
	"encoding/json"
	"net/http"
)

// WriteJSON is the one JSON writer for daemon responses; none are cacheable.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes the daemon's error body, coded from the HTTP status.
func WriteError(w http.ResponseWriter, status int, message string) {
	writeCodedError(w, status, statusCode(status), message)
}

func writeCodedError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, map[string]any{"ok": false, "code": code, "message": message})
}

func writeMappedError(w http.ResponseWriter, err error) {
	status := statusFor(err)
	writeCodedError(w, status, codeFor(err, status), err.Error())
}
