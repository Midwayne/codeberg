package httpserver

import (
	"encoding/json"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func errorBody(code, message string) map[string]any {
	return map[string]any{"ok": false, "code": code, "message": message}
}

func writeMappedError(w http.ResponseWriter, err error) {
	status := statusFor(err)
	writeJSON(w, status, errorBody(codeFor(err, status), err.Error()))
}
