package tools

import (
	"context"
	"sort"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

func getArchitectureTool(idx indexctl.Indexer) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string", "description": "repository key from repos; omitted summarizes all roots configured together"},
    "hub_limit": {"type": "integer", "description": "max degree hubs (default 10)"}
  }
}`

	return New("get_architecture",
		"Get an initial map of an unfamiliar codebase: indexed graph size, language mix, call hubs (symbols with many incoming/outgoing calls), and candidate entrypoints. "+
			"Omit repo to summarize all configured roots, or select one repo. Results retain repo keys. "+
			"Entrypoints are name-based guesses, not verified application boundaries. Follow up with search_graph, trace_path, and source reads. Works without embeddings after parsing.",
		schema,
		func(ctx context.Context, a getArchitectureArgs) (any, error) {
			return getArchitecture(ctx, idx, a)
		})
}

func getArchitecture(ctx context.Context, idx indexctl.Indexer, a getArchitectureArgs) (any, error) {
	hubLimit := a.HubLimit
	if hubLimit <= 0 {
		hubLimit = 10
	}

	stats, err := idx.GraphStats(ctx, a.Repo)
	if err != nil {
		return nil, err
	}

	res := getArchitectureResult{
		Repo:      stats.Repo,
		Nodes:     stats.Nodes,
		Refs:      stats.Refs,
		Languages: append([]indexctl.GraphLangStat(nil), stats.Languages...),
	}
	sort.Slice(res.Languages, func(i, j int) bool { return res.Languages[i].Files > res.Languages[j].Files })

	res.Entrypoints = architectureEntrypoints(ctx, idx, a.Repo)
	hubs, herr := idx.GraphHubs(ctx, indexctl.GraphHubsOptions{Repo: a.Repo, Limit: hubLimit})
	if herr != nil {
		return nil, herr
	}

	for _, h := range hubs {
		res.Hubs = append(res.Hubs, archHub{Repo: h.Repo, Name: h.Name, Path: h.Path, Kind: h.Kind, Degree: h.Degree})
	}

	return res, nil
}

func architectureEntrypoints(ctx context.Context, idx indexctl.Indexer, repo string) []archHub {
	var entrypoints []archHub
	seenEP := map[string]struct{}{}

	for _, name := range []string{"main", "Main", "ServeHTTP", "Handler"} {
		nodes, nerr := idx.SearchGraph(ctx, indexctl.GraphSearchOptions{Name: name, Repo: repo, Kind: "symbol", Limit: 8})
		if nerr != nil {
			continue
		}

		for _, n := range nodes {
			key := n.Repo + "\x00" + n.Path + "\x00" + n.Name + "\x00" + n.Kind
			if _, ok := seenEP[key]; ok {
				continue
			}

			seenEP[key] = struct{}{}
			entrypoints = append(entrypoints, archHub{Repo: n.Repo, Name: n.Name, Path: n.Path, Kind: n.Kind})
		}
	}

	return entrypoints
}

type getArchitectureArgs struct {
	Repo     string `json:"repo"`
	HubLimit int    `json:"hub_limit"`
}

type archHub struct {
	Repo   string `json:"repo,omitempty"`
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
