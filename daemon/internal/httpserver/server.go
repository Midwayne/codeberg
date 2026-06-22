package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"

	"codeberg.org/codeberg/daemon/internal/cberg"
	"codeberg.org/codeberg/daemon/internal/indexer"
)

type Server struct {
	idx *indexer.Indexer
}

func New(idx *indexer.Indexer) *Server {
	return &Server{idx: idx}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("GET /search", s.search)
	return mux
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]string{
		"status":  "ok",
		"version": cberg.Version(),
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
	results, err := s.idx.Search(q, k)
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	type hit struct {
		ID    uint64  `json:"id"`
		Score float32 `json:"score"`
	}
	out := make([]hit, len(results))
	for i, r := range results {
		out[i] = hit{ID: r.ID, Score: r.Score}
	}
	writeJSON(w, map[string]any{"results": out})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}
