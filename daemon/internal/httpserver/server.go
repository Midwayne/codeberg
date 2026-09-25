package httpserver

import (
	"net/http"

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
