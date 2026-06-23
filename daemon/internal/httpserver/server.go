package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/tools"
)

type Indexer interface {
	Status(ctx context.Context) (indexctl.Status, error)
	Search(ctx context.Context, query string, k int) ([]indexctl.SearchResult, error)
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
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, map[string]any{
		"status":  "ok",
		"ready":   st.Ready,
		"chunks":  st.Chunks,
		"version": st.Version,
	})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		http.Error(w, "missing q", http.StatusBadRequest)
		return
	}
	k := 10
	if v := r.URL.Query().Get("k"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			http.Error(w, "invalid k", http.StatusBadRequest)
			return
		}
		k = n
	}
	results, err := s.idx.Search(r.Context(), q, k)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, map[string]any{"results": results})
}

func (s *Server) listTools(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]any{"tools": s.tools.List()})
}

func (s *Server) callTool(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string          `json:"name"`
		Args json.RawMessage `json:"args"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "missing name", http.StatusBadRequest)
		return
	}
	result, err := s.tools.Call(r.Context(), req.Name, req.Args)
	if err != nil {
		http.Error(w, err.Error(), tools.HTTPStatus(err))
		return
	}
	writeJSON(w, map[string]any{"result": result})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}
