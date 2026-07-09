package indexctl

import (
	"fmt"
	"strconv"
	"strings"
)

func encodeSearch(opts SearchOptions) string {
	opts = normalizeSearchOptions(opts)

	hasFilters := opts.PathGlob != "" || opts.Kind != "" || opts.MinScore > 0
	fields := []string{sanitizeTab(opts.Query), strconv.Itoa(opts.K)}

	if opts.Repo != "" || hasFilters {
		fields = append(fields, sanitizeTab(opts.Repo))
	}
	if hasFilters {
		fields = append(fields, sanitizeTab(opts.PathGlob), sanitizeTab(opts.Kind))
		if opts.MinScore > 0 {
			fields = append(fields, fmt.Sprintf("%.6f", opts.MinScore))
		}
	}

	return "search\t" + strings.Join(fields, "\t")
}

func encodeChunk(repo string, id uint64) string {
	return fmt.Sprintf("chunk\t%s\t%d", sanitizeTab(repo), id)
}

func encodeSymbol(opts SymbolOptions) string {
	limit := opts.Limit
	if limit <= 0 {
		limit = 20
	}

	return fmt.Sprintf("symbol\t%s\t%s\t%s\t%d",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), sanitizeTab(opts.Kind), limit)
}

func encodeOutline(repo, path string) string {
	return fmt.Sprintf("outline\t%s\t%s", sanitizeTab(repo), sanitizeTab(path))
}

func encodeSearchGraph(opts GraphSearchOptions) string {
	limit := opts.Limit
	if limit <= 0 {
		limit = 20
	}
	return fmt.Sprintf("search_graph\t%s\t%s\t%s\t%s\t%d",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), sanitizeTab(opts.Kind), sanitizeTab(opts.PathPrefix), limit)
}

func encodeTracePath(opts TracePathOptions) string {
	depth := opts.MaxDepth
	if depth <= 0 {
		depth = 2
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = 64
	}
	return fmt.Sprintf("trace_path\t%s\t%s\t%s\t%s\t%d\t%d\t%s",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), sanitizeTab(opts.Direction), sanitizeTab(opts.EdgeKind), depth, limit, sanitizeTab(opts.PathPrefix))
}

func encodeGraphStats(repo string) string {
	if repo == "" {
		return "graph_stats"
	}
	return "graph_stats\t" + sanitizeTab(repo)
}

func encodeGraphRefs(opts GraphRefsOptions) string {
	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	return fmt.Sprintf("graph_refs\t%s\t%s\t%d", sanitizeTab(opts.Name), sanitizeTab(opts.Repo), limit)
}

func encodeGraphHubs(opts GraphHubsOptions) string {
	limit := opts.Limit
	if limit <= 0 {
		limit = 10
	}
	if opts.Repo == "" {
		return fmt.Sprintf("graph_hubs\t\t%d", limit)
	}
	return fmt.Sprintf("graph_hubs\t%s\t%d", sanitizeTab(opts.Repo), limit)
}

func normalizeSearchOptions(opts SearchOptions) SearchOptions {
	if opts.K <= 0 {
		opts.K = 10
	}
	return opts
}

func sanitizeTab(s string) string {
	return strings.ReplaceAll(s, "\t", " ")
}
