package httpserver

import (
	"net/http"
	"strconv"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

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
