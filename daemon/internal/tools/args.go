package tools

// Tool argument structs — unmarshaled from POST /tools/call JSON bodies.

type reposArgs struct{}

type grepArgs struct {
	Pattern  string `json:"pattern"`
	Literal  bool   `json:"literal"`
	Repo     string `json:"repo"`
	PathGlob string `json:"path_glob"`
	Limit    int    `json:"limit"`
}

type globArgs struct {
	Pattern string `json:"pattern"`
	Repo    string `json:"repo"`
	Limit   int    `json:"limit"`
}

type readFileArgs struct {
	Repo      string `json:"repo"`
	Path      string `json:"path"`
	StartLine uint32 `json:"start_line"`
	EndLine   uint32 `json:"end_line"`
}

type listDirArgs struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
}

type treeArgs struct {
	Repo     string `json:"repo"`
	Path     string `json:"path"`
	MaxDepth int    `json:"max_depth"`
}

type pathLinesArgs struct {
	Repo  string `json:"repo"`
	Path  string `json:"path"`
	Lines int    `json:"lines"`
}

type wcArgs struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
}

type sedArgs struct {
	Repo   string `json:"repo"`
	Path   string `json:"path"`
	Script string `json:"script"`
	Quiet  bool   `json:"quiet"`
}

type pipeArgs struct {
	Command string `json:"command"`
	Repo    string `json:"repo"`
}

type gitLogArgs struct {
	Repo  string `json:"repo"`
	Path  string `json:"path"`
	Limit int    `json:"limit"`
}

type gitBlameArgs struct {
	Repo      string `json:"repo"`
	Path      string `json:"path"`
	StartLine int    `json:"start_line"`
	EndLine   int    `json:"end_line"`
}

type searchArgs struct {
	Query    string  `json:"query"`
	K        int     `json:"k"`
	Repo     string  `json:"repo"`
	PathGlob string  `json:"path_glob"`
	Kind     string  `json:"kind"`
	MinScore float32 `json:"min_score"`
}

type getChunkArgs struct {
	Repo string `json:"repo"`
	ID   uint64 `json:"id"`
}

type findSymbolArgs struct {
	Name  string `json:"name"`
	Repo  string `json:"repo"`
	Kind  string `json:"kind"`
	Limit int    `json:"limit"`
}

type fileOutlineArgs struct {
	Repo string `json:"repo"`
	Path string `json:"path"`
}

type hybridSearchArgs struct {
	Query    string  `json:"query"`
	K        int     `json:"k"`
	Repo     string  `json:"repo"`
	PathGlob string  `json:"path_glob"`
	Kind     string  `json:"kind"`
	MinScore float32 `json:"min_score"`
}

type findReferencesArgs struct {
	Symbol   string `json:"symbol"`
	Repo     string `json:"repo"`
	PathGlob string `json:"path_glob"`
	Limit    int    `json:"limit"`
}
