package projects

// Launch capabilities are response metadata, never persisted project settings.
type catalogResponse struct {
	Catalog
	VectorsEnabled bool `json:"vectorsEnabled"`
}

func (m *Manager) catalogView(catalog Catalog) catalogResponse {
	return catalogResponse{Catalog: catalog, VectorsEnabled: m.base.Model != ""}
}
