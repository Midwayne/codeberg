package projects

import (
	"fmt"
	"os"
	"strings"

	"codeberg.org/codeberg/daemon/internal/storage"
)

// migrateIndex moves a pre-project local index family into project storage.
// It refuses to overwrite: a conflict means both copies need a human decision.
func migrateIndex(legacy, target string) error {
	files, err := storage.IndexFamily(legacy)
	if err != nil {
		return err
	}

	for _, source := range files {
		destination := target + strings.TrimPrefix(source, legacy)
		if _, err := os.Stat(destination); err == nil {
			return fmt.Errorf("index migration conflict: %s", destination)
		} else if !os.IsNotExist(err) {
			return err
		}

		if err := os.Rename(source, destination); err != nil {
			return fmt.Errorf("migrating index %s: %w", source, err)
		}
	}

	return nil
}
