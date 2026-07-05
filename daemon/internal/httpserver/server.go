package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/tools"
)

type Server struct {
	idx   indexctl.Indexer
	tools *tools.Registry
}

func New(idx indexctl.Indexer, reg *tools.Registry) *Server {
	return &Server{idx: idx, tools: reg}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /search", s.search)
	mux.HandleFunc("GET /tools", s.listTools)
	mux.HandleFunc("POST /tools/call", s.callTool)

	return mux
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	st, err := s.idx.Status(r.Context())
	if err != nil {
		writeMappedError(w, err)
		return
	}

	body := map[string]any{
		"status":          "ok",
		"ready":           st.Ready,
		"chunks":          st.Chunks,
		"version":         st.Version,
		"vectors_enabled": st.VectorsEnabled,
	}
	if len(st.Repos) > 0 {
		body["repos"] = st.Repos
	}

	writeJSON(w, http.StatusOK, body)
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("MISSING_QUERY", "missing q"))
		return
	}

	k := 10
	if v := r.URL.Query().Get("k"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			writeJSON(w, http.StatusBadRequest, errorBody("INVALID_K", "invalid k"))
			return
		}
		k = n
	}

	var minScore float32
	if v := r.URL.Query().Get("min_score"); v != "" {
		f, err := strconv.ParseFloat(v, 32)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("INVALID_MIN_SCORE", "invalid min_score"))
			return
		}
		minScore = float32(f)
	}

	results, err := s.idx.Search(r.Context(), indexctl.SearchOptions{
		Query:    q,
		K:        k,
		Repo:     r.URL.Query().Get("repo"),
		PathGlob: r.URL.Query().Get("path_glob"),
		Kind:     r.URL.Query().Get("kind"),
		MinScore: minScore,
	})
	if err != nil {
		writeMappedError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

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
