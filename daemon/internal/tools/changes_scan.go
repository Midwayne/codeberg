package tools

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

func (c *changeScan) collectDirect(ctx context.Context, idx indexctl.Indexer, a detectChangesArgs, hunks map[string]map[uint32]struct{}) {
	for _, path := range c.res.Paths {
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
			if _, ok := c.seenDirect[key]; ok {
				continue
			}

			c.seenDirect[key] = struct{}{}
			c.res.Direct = append(c.res.Direct, changeSymbol{
				Name: hit.Symbol, Path: hit.Path, StartLine: hit.StartLine, EndLine: hit.EndLine, Risk: "direct",
			})
			c.traces = append(c.traces, pendingTrace{name: hit.Symbol, path: hit.Path})
			if len(c.res.Direct) >= c.directBudget {
				break
			}
		}

		if len(c.res.Direct) >= c.directBudget {
			break
		}
	}
}

func (c *changeScan) collectIndirect(ctx context.Context, idx indexctl.Indexer, a detectChangesArgs, depth, limit int) {
	for _, t := range c.traces {
		if len(c.res.Direct)+len(c.res.Indirect) >= limit {
			break
		}

		hops, terr := idx.TracePath(ctx, indexctl.TracePathOptions{
			Name: t.name, Repo: a.Repo, PathPrefix: t.path, Direction: "both", EdgeKind: "calls", MaxDepth: depth, Limit: 32,
		})
		if terr != nil {
			continue
		}

		if c.addHops(hops, t, limit) {
			return
		}
	}
}

func (c *changeScan) addHops(hops []indexctl.GraphHop, t pendingTrace, limit int) bool {
	for _, h := range hops {
		for _, side := range []struct{ name, path string }{
			{h.SrcName, h.SrcPath}, {h.DstName, h.DstPath},
		} {
			if side.name == "" || (side.name == t.name && side.path == t.path) {
				continue
			}

			ik := side.name + "@" + side.path
			if _, ok := c.seenDirect[ik]; ok {
				continue
			}

			if _, ok := c.seenIndirect[ik]; ok {
				continue
			}

			c.seenIndirect[ik] = struct{}{}
			c.res.Indirect = append(c.res.Indirect, changeSymbol{
				Name: side.name, Path: side.path, Risk: "transitive",
			})
			if len(c.res.Direct)+len(c.res.Indirect) >= limit {
				return true
			}
		}
	}
	return false
}
