package httpserver

import "net/http"

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
