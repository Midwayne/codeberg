package tools

import (
	"codeberg.org/codeberg/daemon/internal/indexctl"
)

type detectChangesArgs struct {
	Repo  string `json:"repo"`
	Base  string `json:"base"`
	Head  string `json:"head"`
	Depth int    `json:"depth"`
	Limit int    `json:"limit"`
}

type getArchitectureArgs struct {
	Repo     string `json:"repo"`
	HubLimit int    `json:"hub_limit"`
}

type changeSymbol struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	StartLine uint32 `json:"start_line,omitempty"`
	EndLine   uint32 `json:"end_line,omitempty"`
	Risk      string `json:"risk"` // direct | transitive
}

type detectChangesResult struct {
	Base     string         `json:"base"`
	Head     string         `json:"head"`
	DiffSpec string         `json:"diff_spec"`          // actual git range used
	Fallback string         `json:"fallback,omitempty"` // set when base...head failed
	Paths    []string       `json:"paths"`
	Direct   []changeSymbol `json:"direct"`
	Indirect []changeSymbol `json:"indirect"`
}

type archHub struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Degree int    `json:"degree"`
}

type getArchitectureResult struct {
	Repo        string                   `json:"repo"`
	Nodes       int                      `json:"nodes"`
	Refs        int                      `json:"refs"`
	Languages   []indexctl.GraphLangStat `json:"languages"`
	Hubs        []archHub                `json:"hubs"`
	Entrypoints []archHub                `json:"entrypoints"`
}
