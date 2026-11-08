package projects

// Launch capabilities and storage paths are response metadata derived from
// the daemon's settings, never persisted project settings.
type catalogResponse struct {
	Catalog
	VectorsEnabled bool                      `json:"vectorsEnabled"`
	Storage        map[string]projectStorage `json:"storage"`
}

// projectStorage tells clients where a project's data lives so they never
// re-derive the daemon's layout or its upgrade exceptions.
type projectStorage struct {
	Dir   string `json:"dir"`
	Index string `json:"index"`
	Logs  string `json:"logs"`
}

func (m *Manager) catalogView(catalog Catalog) catalogResponse {
	view := catalogResponse{Catalog: catalog, VectorsEnabled: m.base.VectorsEnabled(), Storage: map[string]projectStorage{}}

	for _, p := range catalog.Projects {
		cfg := m.projectConfig(p)
		view.Storage[p.ID] = projectStorage{Dir: m.layout.ProjectDir(p.ID), Index: cfg.Index, Logs: cfg.LogDir}
	}

	return view
}
