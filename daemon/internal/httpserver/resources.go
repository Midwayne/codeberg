package httpserver

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strconv"
)

func (s *Server) localResources(w http.ResponseWriter, r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || !ip.IsLoopback() {
		http.Error(w, "resource monitoring is local only", http.StatusForbidden)
		return false
	}

	if s.resources == nil {
		http.Error(w, "resource monitoring unavailable", http.StatusServiceUnavailable)
		return false
	}

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Codeberg-Pid", strconv.Itoa(os.Getpid()))
	return true
}

func (s *Server) resourceUsage(w http.ResponseWriter, r *http.Request) {
	if !s.localResources(w, r) {
		return
	}

	var after int64
	if value := r.URL.Query().Get("after"); value != "" {
		var err error
		after, err = strconv.ParseInt(value, 10, 64)
		if err != nil || after < 0 {
			http.Error(w, "invalid history cursor", http.StatusBadRequest)
			return
		}
	}

	writeJSON(w, http.StatusOK, s.resources.Usage(after))
}

func (s *Server) registerResourceClient(w http.ResponseWriter, r *http.Request) {
	if !s.localResources(w, r) {
		return
	}

	var body struct {
		PID int `json:"pid"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		http.Error(w, "invalid web process", http.StatusBadRequest)
		return
	}

	if err := s.resources.Register(body.PID); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) refreshResourceDisk(w http.ResponseWriter, r *http.Request) {
	if !s.localResources(w, r) {
		return
	}

	s.resources.InvalidateDisk()
	w.WriteHeader(http.StatusAccepted)
}
