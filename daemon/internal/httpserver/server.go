package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/tools"
)

// Indexer is the subset of indexctl the HTTP server needs.
type Indexer interface {
	Status(ctx context.Context) (indexctl.Status, error)
	Search(ctx context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error)
	GetChunk(ctx context.Context, repo string, id uint64) (indexctl.ChunkDetail, error)
	FindSymbol(ctx context.Context, opts indexctl.SymbolOptions) ([]indexctl.SearchResult, error)
	FileOutline(ctx context.Context, repo, path string) ([]indexctl.SearchResult, error)
}

type Server struct {
	idx   Indexer
	tools *tools.Registry
}

func New(idx Indexer, reg *tools.Registry) *Server {
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
		writeError(w, err)
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
		writeError(w, err)
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
		writeToolError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func errorBody(code, message string) map[string]any {
	return map[string]any{"ok": false, "code": code, "message": message}
}

func writeError(w http.ResponseWriter, err error) {
	status := indexctl.HTTPStatus(err)

	var ie *indexctl.IndexerError
	if errors.As(err, &ie) {
		writeJSON(w, status, errorBody(ie.Code, ie.Message))
		return
	}

	writeJSON(w, status, errorBody("INDEXER_ERROR", err.Error()))
}

func writeToolError(w http.ResponseWriter, err error) {
	var ie *indexctl.IndexerError
	if errors.As(err, &ie) {
		writeJSON(w, indexctl.HTTPStatus(err), errorBody(ie.Code, ie.Message))
		return
	}

	status := tools.HTTPStatus(err)
	msg := err.Error()
	code := "TOOL_ERROR"

	switch status {
	case http.StatusNotFound:
		code = "NOT_FOUND"
	case http.StatusForbidden:
		code = "FORBIDDEN"
	case http.StatusBadRequest:
		code = "INVALID_ARGS"
	}

	writeJSON(w, status, errorBody(code, msg))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}
