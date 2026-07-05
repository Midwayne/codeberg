package tools

import "codeberg.org/codeberg/daemon/internal/indexctl"

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

type pipeResult struct {
	Command   string `json:"command"`
	Stdout    string `json:"stdout"`
	Truncated bool   `json:"truncated"`
	ExitCodes []int  `json:"exit_codes"`
}

type hybridRanked struct {
	Hit        indexctl.SearchResult `json:"hit"`
	GrepBoost  int                   `json:"grep_boost"`
	FinalScore float32               `json:"final_score"`
}
