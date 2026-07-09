package tools

import (
	"context"
	"sort"

	"codeberg.org/codeberg/daemon/internal/git"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
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
	DiffSpec string         `json:"diff_spec"`           // actual git range used
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
	Repo        string                  `json:"repo"`
	Nodes       int                     `json:"nodes"`
	Refs        int                     `json:"refs"`
	Languages   []indexctl.GraphLangStat `json:"languages"`
	Hubs        []archHub               `json:"hubs"`
	Entrypoints []archHub               `json:"entrypoints"`
}

func symbolTouchesHunk(start, end uint32, lines map[uint32]struct{}) bool {
	if len(lines) == 0 {
		return false
	}
	if start == 0 {
		return true
	}
	if end < start {
		end = start
	}
	for line := range lines {
		if line >= start && line <= end {
			return true
		}
	}
	return false
}

func detectChangesTool(idx indexctl.Indexer, ws *workspace.Workspace) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string", "description": "repo key"},
    "base": {"type": "string", "description": "git base ref (default HEAD~1)"},
    "head": {"type": "string", "description": "git head ref (default HEAD)"},
    "depth": {"type": "integer", "description": "graph hop depth for blast radius (default 2)"},
    "limit": {"type": "integer", "description": "max symbols to report (default 40)"}
  }
}`

	return New("detect_changes",
		"Map a git diff to symbols overlapping changed hunks and 1–2 hop graph neighbors (blast radius). Risk: direct = symbols intersecting the diff; transitive = callers/callees via trace_path. On range failure, falls back to working-tree vs HEAD and sets fallback.",
		schema,
		func(ctx context.Context, a detectChangesArgs) (any, error) {
			base := a.Base
			if base == "" {
				base = "HEAD~1"
			}
			head := a.Head
			if head == "" {
				head = "HEAD"
			}
			depth := a.Depth
			if depth <= 0 {
				depth = 2
			}
			limit := a.Limit
			if limit <= 0 {
				limit = 40
			}

			root, err := ws.RepoRoot(a.Repo)
			if err != nil {
				return nil, err
			}

			diffSpec := base + "..." + head
			fallback := ""
			hunkOut, err := git.Run(ctx, root, "diff", "-U0", diffSpec)
			if err != nil {
				// Honest fallback: working tree (staged+unstaged) vs HEAD.
				fallback = "working-tree-vs-HEAD"
				diffSpec = "HEAD"
				hunkOut, err = git.Run(ctx, root, "diff", "-U0", "HEAD")
				if err != nil {
					return nil, err
				}
			}
			hunks := git.ParseDiffHunks(hunkOut)
			paths := git.DiffPaths(hunks)
			res := detectChangesResult{Base: base, Head: head, DiffSpec: diffSpec, Fallback: fallback, Paths: paths}

			directBudget := limit
			if directBudget > limit/2 && limit >= 4 {
				directBudget = limit / 2 // reserve room for transitive
			}

			seenDirect := map[string]struct{}{}
			seenIndirect := map[string]struct{}{}
			type pendingTrace struct {
				name, path string
			}
			var traces []pendingTrace

			for _, path := range paths {
				if path == "" {
					continue
				}
				outline, oerr := idx.FileOutline(ctx, a.Repo, path)
				if oerr != nil {
					continue
				}
				fileHunks := hunks[path]
				for _, hit := range outline {
					if !symbolTouchesHunk(hit.StartLine, hit.EndLine, fileHunks) {
						continue
					}
					key := hit.Symbol + "@" + hit.Path
					if _, ok := seenDirect[key]; ok {
						continue
					}
					seenDirect[key] = struct{}{}
					res.Direct = append(res.Direct, changeSymbol{
						Name: hit.Symbol, Path: hit.Path, StartLine: hit.StartLine, EndLine: hit.EndLine, Risk: "direct",
					})
					traces = append(traces, pendingTrace{name: hit.Symbol, path: hit.Path})
					if len(res.Direct) >= directBudget {
						break
					}
				}
				if len(res.Direct) >= directBudget {
					break
				}
			}

			for _, t := range traces {
				if len(res.Direct)+len(res.Indirect) >= limit {
					break
				}
				hops, terr := idx.TracePath(ctx, indexctl.TracePathOptions{
					Name: t.name, Repo: a.Repo, PathPrefix: t.path, Direction: "both", EdgeKind: "calls", MaxDepth: depth, Limit: 32,
				})
				if terr != nil {
					continue
				}
				for _, h := range hops {
					for _, side := range []struct{ name, path string }{
						{h.SrcName, h.SrcPath}, {h.DstName, h.DstPath},
					} {
						if side.name == "" || (side.name == t.name && side.path == t.path) {
							continue
						}
						ik := side.name + "@" + side.path
						if _, ok := seenDirect[ik]; ok {
							continue
						}
						if _, ok := seenIndirect[ik]; ok {
							continue
						}
						seenIndirect[ik] = struct{}{}
						res.Indirect = append(res.Indirect, changeSymbol{
							Name: side.name, Path: side.path, Risk: "transitive",
						})
						if len(res.Direct)+len(res.Indirect) >= limit {
							return res, nil
						}
					}
				}
			}
			return res, nil
		})
}

func getArchitectureTool(idx indexctl.Indexer) Tool {
	const schema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "repo": {"type": "string", "description": "repo key"},
    "hub_limit": {"type": "integer", "description": "max degree hubs (default 10)"}
  }
}`

	return New("get_architecture",
		"Repo structural overview from the knowledge graph: size, language mix (FILE nodes), CALLS degree hubs (graph_hubs), and entrypoint heuristics (main/ServeHTTP).",
		schema,
		func(ctx context.Context, a getArchitectureArgs) (any, error) {
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

			seenEP := map[string]struct{}{}
			for _, name := range []string{"main", "Main", "ServeHTTP", "Handler"} {
				nodes, nerr := idx.SearchGraph(ctx, indexctl.GraphSearchOptions{Name: name, Repo: a.Repo, Kind: "symbol", Limit: 8})
				if nerr != nil {
					continue
				}
				for _, n := range nodes {
					key := n.Path + "\x00" + n.Name + "\x00" + n.Kind
					if _, ok := seenEP[key]; ok {
						continue
					}
					seenEP[key] = struct{}{}
					res.Entrypoints = append(res.Entrypoints, archHub{Name: n.Name, Path: n.Path, Kind: n.Kind})
				}
			}

			hubs, herr := idx.GraphHubs(ctx, indexctl.GraphHubsOptions{Repo: a.Repo, Limit: hubLimit})
			if herr != nil {
				return nil, herr
			}
			for _, h := range hubs {
				res.Hubs = append(res.Hubs, archHub{Name: h.Name, Path: h.Path, Kind: h.Kind, Degree: h.Degree})
			}

			return res, nil
		})
}
