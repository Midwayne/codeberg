package httpserver

import (
	"net/http"
	"os"
)

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	st, err := s.idx.Status(r.Context())
	if err != nil {
		writeMappedError(w, err)
		return
	}

	body := map[string]any{
		"status":          "ok",
		"pid":             os.Getpid(),
		"ready":           st.Ready,
		"indexing":        st.Indexing,
		"chunks":          st.Chunks,
		"version":         st.Version,
		"vectors_enabled": st.VectorsEnabled,
	}
	if len(st.Repos) > 0 {
		body["repos"] = st.Repos
	}
	if st.Progress != nil {
		body["progress"] = st.Progress
	}

	writeJSON(w, http.StatusOK, body)
}
