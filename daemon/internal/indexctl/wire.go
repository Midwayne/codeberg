package indexctl

import (
	"fmt"
	"strconv"
	"strings"
)

// Counts left at zero are sent as empty fields; cberg-index owns every
// default and maximum (see daemon/docs/ipc.md).

func encodeSearch(opts SearchOptions) string {
	hasFilters := opts.PathGlob != "" || opts.Kind != "" || opts.MinScore > 0
	fields := []string{sanitizeTab(opts.Query), count(opts.K)}

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
	return fmt.Sprintf("symbol\t%s\t%s\t%s\t%s",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), sanitizeTab(opts.Kind), count(opts.Limit))
}

func encodeOutline(repo, path string) string {
	return fmt.Sprintf("outline\t%s\t%s", sanitizeTab(repo), sanitizeTab(path))
}

func encodeSearchGraph(opts GraphSearchOptions) string {
	return fmt.Sprintf("search_graph\t%s\t%s\t%s\t%s\t%s",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), sanitizeTab(opts.Kind), sanitizeTab(opts.PathPrefix), count(opts.Limit))
}

func encodeTracePath(opts TracePathOptions) string {
	return fmt.Sprintf("trace_path\t%s\t%s\t%s\t%s\t%s\t%s\t%s",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), sanitizeTab(opts.Direction), sanitizeTab(opts.EdgeKind),
		count(opts.MaxDepth), count(opts.Limit), sanitizeTab(opts.PathPrefix))
}

func encodeGraphStats(repo string) string {
	if repo == "" {
		return "graph_stats"
	}
	return "graph_stats\t" + sanitizeTab(repo)
}

func encodeGraphRefs(opts GraphRefsOptions) string {
	return fmt.Sprintf("graph_refs\t%s\t%s\t%s\t%s",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), count(opts.Limit), sanitizeTab(opts.PathPrefix))
}

func encodeGraphHubs(opts GraphHubsOptions) string {
	return fmt.Sprintf("graph_hubs\t%s\t%s", sanitizeTab(opts.Repo), count(opts.Limit))
}

// count encodes a result count; zero or negative means "indexer default".
func count(n int) string {
	if n <= 0 {
		return ""
	}
	return strconv.Itoa(n)
}

func sanitizeTab(s string) string {
	return strings.ReplaceAll(s, "\t", " ")
}
