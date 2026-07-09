package tools

import (
	"context"
	"sort"
	"strings"

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
	Kind      string `json:"kind,omitempty"`
	StartLine uint32 `json:"start_line,omitempty"`
	EndLine   uint32 `json:"end_line,omitempty"`
	Risk      string `json:"risk"` // direct | transitive
}

type detectChangesResult struct {
	Base     string         `json:"base"`
	Head     string         `json:"head"`
	Paths    []string       `json:"paths"`
	Direct   []changeSymbol `json:"direct"`
	Indirect []changeSymbol `json:"indirect"`
}

type archLang struct {
	Lang  string `json:"lang"`
	Files int    `json:"files"`
}

type archHub struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Degree int    `json:"degree"`
}

type getArchitectureResult struct {
	Repo        string    `json:"repo"`
	Nodes       int       `json:"nodes"`
	Refs        int       `json:"refs"`
	Languages   []archLang `json:"languages"`
	Hubs        []archHub `json:"hubs"`
	Entrypoints []archHub `json:"entrypoints"`
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
		"Map a git diff to symbols and 1–2 hop graph neighbors (blast radius). Risk: direct = in changed files; transitive = callers/callees via trace_path.",
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
			out, err := git.Run(ctx, root, "diff", "--name-only", base+"..."+head)
			if err != nil {
				// Fallback: unstaged + staged vs HEAD
				out, err = git.Run(ctx, root, "diff", "--name-only", "HEAD")
				if err != nil {
					return nil, err
				}
			}
			paths := git.ParseLog(out)
			res := detectChangesResult{Base: base, Head: head, Paths: paths}

			seenDirect := map[string]struct{}{}
			seenIndirect := map[string]struct{}{}
			for _, path := range paths {
				if path == "" {
					continue
				}
				outline, oerr := idx.FileOutline(ctx, a.Repo, path)
				if oerr != nil {
					continue
				}
				for _, hit := range outline {
					key := hit.Symbol + "@" + hit.Path
					if _, ok := seenDirect[key]; ok {
						continue
					}
					seenDirect[key] = struct{}{}
					sym := changeSymbol{
						Name: hit.Symbol, Path: hit.Path, StartLine: hit.StartLine, EndLine: hit.EndLine, Risk: "direct",
					}
					res.Direct = append(res.Direct, sym)
					if len(res.Direct)+len(res.Indirect) >= limit {
						return res, nil
					}

					hops, terr := idx.TracePath(ctx, indexctl.TracePathOptions{
						Name: hit.Symbol, Repo: a.Repo, Direction: "both", EdgeKind: "calls", MaxDepth: depth, Limit: 32,
					})
					if terr != nil {
						continue
					}
					for _, h := range hops {
						for _, side := range []struct{ name, path string }{
							{h.SrcName, h.SrcPath}, {h.DstName, h.DstPath},
						} {
							if side.name == "" || side.name == hit.Symbol {
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
		"Repo structural overview from the knowledge graph: size, language mix (via search_graph samples), call-graph hubs, and entrypoint heuristics (main).",
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
				Repo:  stats.Repo,
				Nodes: stats.Nodes,
				Refs:  stats.Refs,
			}

			// Entrypoints: symbols named main / Main / handle*
			for _, name := range []string{"main", "Main", "ServeHTTP", "Handler"} {
				nodes, nerr := idx.SearchGraph(ctx, indexctl.GraphSearchOptions{Name: name, Repo: a.Repo, Kind: "symbol", Limit: 8})
				if nerr != nil {
					continue
				}
				for _, n := range nodes {
					res.Entrypoints = append(res.Entrypoints, archHub{Name: n.Name, Path: n.Path, Kind: n.Kind})
				}
			}

			// Approximate hubs: sample known high-traffic names via trace fan-in on entrypoints.
			deg := map[string]archHub{}
			for _, ep := range res.Entrypoints {
				hops, terr := idx.TracePath(ctx, indexctl.TracePathOptions{
					Name: ep.Name, Repo: a.Repo, Direction: "both", EdgeKind: "calls", MaxDepth: 1, Limit: 64,
				})
				if terr != nil {
					continue
				}
				bump := func(name, path, kind string) {
					if name == "" {
						return
					}
					key := name + "@" + path
					h := deg[key]
					h.Name = name
					h.Path = path
					h.Kind = kind
					h.Degree++
					deg[key] = h
				}
				bump(ep.Name, ep.Path, ep.Kind)
				for _, h := range hops {
					bump(h.SrcName, h.SrcPath, h.Kind)
					bump(h.DstName, h.DstPath, h.Kind)
				}
			}
			hubs := make([]archHub, 0, len(deg))
			for _, h := range deg {
				hubs = append(hubs, h)
			}
			sort.Slice(hubs, func(i, j int) bool {
				if hubs[i].Degree != hubs[j].Degree {
					return hubs[i].Degree > hubs[j].Degree
				}
				return hubs[i].Name < hubs[j].Name
			})
			if len(hubs) > hubLimit {
				hubs = hubs[:hubLimit]
			}
			res.Hubs = hubs

			// Language mix from path extensions on hubs + entrypoints.
			langCount := map[string]int{}
			countPath := func(p string) {
				ext := ""
				if i := strings.LastIndex(p, "."); i >= 0 {
					ext = strings.ToLower(p[i+1:])
				}
				switch ext {
				case "go":
					langCount["go"]++
				case "ts", "tsx":
					langCount["typescript"]++
				case "js", "jsx":
					langCount["javascript"]++
				case "py":
					langCount["python"]++
				case "rs":
					langCount["rust"]++
				case "c", "h":
					langCount["c"]++
				case "java":
					langCount["java"]++
				case "kt":
					langCount["kotlin"]++
				case "rb":
					langCount["ruby"]++
				}
			}
			for _, h := range res.Hubs {
				countPath(h.Path)
			}
			for _, h := range res.Entrypoints {
				countPath(h.Path)
			}
			for lang, n := range langCount {
				res.Languages = append(res.Languages, archLang{Lang: lang, Files: n})
			}
			sort.Slice(res.Languages, func(i, j int) bool { return res.Languages[i].Files > res.Languages[j].Files })

			return res, nil
		})
}
