package tools

import "codeberg.org/codeberg/daemon/internal/workspace"

func Default(ws *workspace.Workspace) *Registry {
	r := NewRegistry()
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
