import { FileCode, Loader2, Search } from "lucide-react";

import { Response } from "@/components/response";
import { CopyButton } from "@/components/ui";
import { langFromPath } from "@/lib/utils";
import type { ToolView } from "@/components/message";

interface Hit {
  id?: number | string;
  path?: string;
  symbol?: string;
  lines?: string;
  snippet?: string;
}

/**
 * Renders the agent's `search_code` tool calls as rich result cards rather than
 * raw JSON — the most important surface for a code-search agent. While the
 * search runs it shows a live status; on completion, one card per hit with the
 * file path, line range, and a syntax-highlighted snippet.
 */
export function SearchResults({ part }: { part: ToolView }) {
  const query =
    part.input && typeof part.input === "object"
      ? (part.input as { query?: string }).query
      : undefined;

  if (part.state !== "output-available") {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        <span>Searching{query ? ` for “${query}”` : ""}…</span>
      </div>
    );
  }

  const hits: Hit[] = Array.isArray(part.output) ? (part.output as Hit[]) : [];

  return (
    <div className="my-2 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Search className="size-3.5" />
        <span>
          {hits.length} result{hits.length === 1 ? "" : "s"}
          {query ? ` for “${query}”` : ""}
        </span>
      </div>
      <div className="grid gap-2">
        {hits.map((hit, i) => (
          <SourceCard key={hit.id ?? i} hit={hit} />
        ))}
      </div>
    </div>
  );
}

function SourceCard({ hit }: { hit: Hit }) {
  const path = hit.path ?? "";
  const lang = langFromPath(path);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-foreground" title={path}>
          {path}
        </span>
        {hit.lines && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            :{hit.lines}
          </span>
        )}
        <CopyButton
          text={hit.lines ? `${path}:${hit.lines}` : path}
          className="ml-auto shrink-0"
          label="Copy path"
        />
      </div>
      {hit.symbol && (
        <div className="px-3 pt-2 font-mono text-xs text-muted-foreground">
          {hit.symbol}
        </div>
      )}
      {hit.snippet && (
        <div className="px-3 py-2 text-xs">
          <Response>{`\`\`\`${lang}\n${hit.snippet}\n\`\`\``}</Response>
        </div>
      )}
    </div>
  );
}
