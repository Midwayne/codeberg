package httpserver

import (
	"encoding/json"
	"net/http"
)

func (s *Server) listTools(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"tools": s.tools.List()})
}

func (s *Server) callTool(w http.ResponseWriter, r *http.Request) {
	var req toolCallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("INVALID_JSON", "invalid json"))
		return
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("MISSING_NAME", "missing name"))
		return
	}

	result, err := s.tools.Call(r.Context(), req.Name, req.Args)
	if err != nil {
		writeMappedError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}
