// Package storage owns the on-disk layout of the Codeberg home directory that
// the daemon writes: the project catalog, per-project data and vector indexes.
// Other components ask `codeberg-d storage` for these paths instead of copying
// the layout.
package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
)

// IndexFile is the base name the daemon passes to the indexer. The indexer
// derives every sidecar as "<base>.<suffix>".
const IndexFile = "codeberg.usearch"

type Layout struct {
	Home string
}

func (l Layout) Catalog() string {
	return filepath.Join(l.Home, "projects.json")
}

func (l Layout) Projects() string {
	return filepath.Join(l.Home, "projects")
}

func (l Layout) ProjectDir(id string) string {
	return filepath.Join(l.Projects(), id)
}

func (l Layout) ProjectIndexDir(id string) string {
	return filepath.Join(l.ProjectDir(id), "index")
}

// ProjectIndex separates embedding models: vectors from different models must
// never share an index, even when their dimensions match.
func (l Layout) ProjectIndex(id, namespace string) string {
	return filepath.Join(l.ProjectIndexDir(id), namespace, IndexFile)
}

func (l Layout) ProjectLogs(id string) string {
	return filepath.Join(l.ProjectDir(id), "logs")
}

// ProjectSocket stays short because Unix socket paths have a small OS limit;
// hashing the project directory keeps separate homes from colliding.
func (l Layout) ProjectSocket(id string) string {
	sum := sha256.Sum256([]byte(l.ProjectDir(id)))
	return filepath.Join(os.TempDir(), "cberg-"+hex.EncodeToString(sum[:12])+".sock")
}

// LegacyIndexDir held every index before per-project storage existed.
func (l Layout) LegacyIndexDir() string {
	return filepath.Join(l.Home, "index")
}

func (l Layout) InLegacyIndexDir(path string) bool {
	return strings.HasPrefix(path, l.LegacyIndexDir()+string(filepath.Separator))
}

// Owned lists the top-level paths the daemon creates under Home.
func (l Layout) Owned() []string {
	return []string{l.Catalog(), l.Projects(), l.LegacyIndexDir()}
}
