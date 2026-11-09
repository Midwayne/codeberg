package projects

import (
	"codeberg.org/codeberg/daemon/internal/storage"
)

// StorageReport describes everything the daemon stores for home, including a
// pre-project index the catalog still uses outside the managed directories.
func StorageReport(home string) (storage.Report, error) {
	layout := storage.Layout{Home: home}

	report, err := layout.Report()
	if err != nil {
		return storage.Report{}, err
	}

	catalog, err := readCatalog(layout.Catalog())
	if err != nil {
		return storage.Report{}, err
	}

	for _, p := range catalog.Projects {
		if p.LegacyIndex == "" || layout.InLegacyIndexDir(p.LegacyIndex) {
			continue
		}

		files, err := storage.IndexFamily(p.LegacyIndex)
		if err != nil {
			return storage.Report{}, err
		}

		if len(files) > 0 {
			report.IndexSets = append(report.IndexSets, storage.IndexSet{Name: p.ID + ":external", Files: files})
		}
	}

	return report, nil
}
