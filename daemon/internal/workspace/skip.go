package workspace

// SkipDir names directories excluded from tree walks, aligned with the C
// indexer walk policy (cberg_walk_skip_dir).
func SkipDir(name string) bool {
	switch name {
	case ".git", "node_modules", "vendor", ".venv", "__pycache__", ".next",
		"dist", "build", "target", ".gradle", ".idea", ".terraform":
		return true
	default:
		return false
	}
}
