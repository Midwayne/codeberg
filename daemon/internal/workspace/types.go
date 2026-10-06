package workspace

type GrepMatch struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
	Line uint32 `json:"line"`
	Text string `json:"text"`
}

type FileRef struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
}

type DirEntry struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
}

type FileContent struct {
	Content    string `json:"content"`
	StartLine  uint32 `json:"start_line"`
	EndLine    uint32 `json:"end_line"`
	TotalLines uint32 `json:"total_lines"`
}

type TreeNode struct {
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Depth int    `json:"depth"`
}
