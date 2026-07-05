package tools

// Tool result structs returned to agents via POST /tools/call.

type headTailResult struct {
	Content string `json:"content"`
	Lines   int    `json:"lines"`
}

type wcResult struct {
	Lines int `json:"lines"`
	Words int `json:"words"`
	Bytes int `json:"bytes"`
}

type sedResult struct {
	Content   string `json:"content"`
	Truncated bool   `json:"truncated"`
}

type gitBlameResult struct {
	Blame     string `json:"blame"`
	Truncated bool   `json:"truncated"`
}
