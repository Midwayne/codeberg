package tools

import (
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func Default(ws *workspace.Workspace, idx indexctl.Indexer) *Registry {
	return WithVectorSearch(ws, idx, true)
}

// WithVectorSearch builds the tool catalogue for the configured startup mode.
func WithVectorSearch(ws *workspace.Workspace, idx indexctl.Indexer, vectors bool) *Registry {
	r := NewRegistry()
	r.Register(reposTool(ws))
	registerIndexTools(r, idx, ws, vectors)
	r.Register(grepTool(ws))
	r.Register(globTool(ws))
	r.Register(readFileTool(ws))
	r.Register(listDirTool(ws))
	r.Register(treeTool(ws))
	r.Register(headTool(ws))
	r.Register(tailTool(ws))
	r.Register(wcTool(ws))
	r.Register(sedTool(ws))
	r.Register(pipeTool(ws))
	r.Register(gitLogTool(ws))
	r.Register(gitBlameTool(ws))
	return r
}
