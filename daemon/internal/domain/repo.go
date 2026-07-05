package domain

// Repo is one served repository: a stable key and its resolved absolute root.
type Repo struct {
	Key  string `json:"key"`
	Root string `json:"root"`
}
