import type { ReactNode } from 'react';
import {
  FileCode,
  FileSearch,
  FolderTree,
  GitBranch,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';

import { Response } from '@/components/response';
import type { ToolView } from '@/components/message';
import { Collapsible, CopyButton } from '@/components/ui';
import { langFromPath } from '@/lib/utils';

interface Hit {
  id?: number | string;
  repo?: string;
  path?: string;
  symbol?: string;
  lines?: string;
  start_line?: number;
  end_line?: number;
  score?: number;
  snippet?: string;
  body?: string;
  kind?: string;
}

interface GrepMatch {
  repo?: string;
  path?: string;
  line?: number;
  text?: string;
}

/** Dispatch to a rich renderer when we know the tool shape; otherwise JSON. */
export function ToolViewRouter({ part }: { part: ToolView }) {
  const name =
    part.type === 'dynamic-tool'
      ? (part.toolName ?? 'tool')
      : part.type.startsWith('tool-')
        ? part.type.slice('tool-'.length)
        : 'tool';

  if (part.state !== 'output-available' && part.state !== 'output-error') {
    return <ToolPending name={name} part={part} />;
  }

  if (part.state === 'output-error') {
    return <ToolError name={name} message={part.errorText ?? 'tool failed'} />;
  }

  switch (name) {
    case 'search_code':
      return <SearchResults part={part} />;
    case 'hybrid_search':
      return <HybridSearchResults part={part} />;
    case 'find_symbol':
    case 'file_outline':
      return <ChunkHits title={name === 'find_symbol' ? 'Symbols' : 'Outline'} part={part} />;
    case 'get_chunk':
      return <ChunkDetail part={part} />;
    case 'grep':
    case 'find_references':
      return <GrepResults title={name === 'grep' ? 'Grep' : 'References'} part={part} />;
    case 'read_file':
    case 'head':
    case 'tail':
      return <FileContent part={part} />;
    case 'glob':
    case 'list_dir':
    case 'tree':
      return <FileList title={name} part={part} />;
    case 'repos':
      return <ReposList part={part} />;
    case 'pipe':
    case 'wc':
    case 'sed':
    case 'git_log':
    case 'git_blame':
      return <TextOutput title={name} part={part} />;
    default:
      return <GenericTool part={part} name={name} />;
  }
}

function ToolPending({ name, part }: { name: string; part: ToolView }) {
  const query =
    part.input && typeof part.input === 'object'
      ? (part.input as { query?: string; pattern?: string; name?: string; symbol?: string })
      : undefined;
  const label =
    query?.query ??
    query?.pattern ??
    query?.name ??
    query?.symbol ??
    (part.input && typeof part.input === 'object'
      ? ((part.input as { path?: string }).path ?? '')
      : '');

  return (
    <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      <span>
        Running <span className="font-mono">{name}</span>
        {label ? ` — “${label}”` : ''}…
      </span>
    </div>
  );
}

function ToolError({ name, message }: { name: string; message: string }) {
  return (
    <div className="my-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <span className="font-mono">{name}</span>: {message}
    </div>
  );
}

export function SearchResults({ part }: { part: ToolView }) {
  const query = inputQuery(part);
  if (part.state !== 'output-available') {
    return <ToolPending name="search_code" part={part} />;
  }
  const hits = normalizeHits(part.output);
  return (
    <HitList
      icon={<Search className="size-3.5" />}
      title={`${hits.length} result${hits.length === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}`}
      hits={hits}
    />
  );
}

function HybridSearchResults({ part }: { part: ToolView }) {
  const query = inputQuery(part);
  if (part.state !== 'output-available') {
    return <ToolPending name="hybrid_search" part={part} />;
  }
  const rows = Array.isArray(part.output) ? part.output : [];
  const hits = rows
    .map((row) => {
      if (!row || typeof row !== 'object' || !('hit' in row)) return null;
      const hit = normalizeHit((row as { hit: unknown }).hit);
      if (!hit) return null;
      const boost = Number((row as { grep_boost?: number }).grep_boost ?? 0);
      const score = Number((row as { final_score?: number }).final_score ?? hit.score ?? 0);
      return { ...hit, score, snippet: hit.snippet + (boost > 0 ? `\n// lexical boost: +${boost}` : '') };
    })
    .filter((h): h is Hit => h != null);
  return (
    <HitList
      icon={<FileSearch className="size-3.5" />}
      title={`${hits.length} hybrid result${hits.length === 1 ? '' : 's'}${query ? ` for “${query}”` : ''}`}
      hits={hits}
    />
  );
}

function ChunkHits({ title, part }: { title: string; part: ToolView }) {
  if (part.state !== 'output-available') {
    return <ToolPending name={title.toLowerCase()} part={part} />;
  }
  const hits = normalizeHits(part.output);
  return (
    <HitList
      icon={<FileCode className="size-3.5" />}
      title={`${hits.length} ${title.toLowerCase()} hit${hits.length === 1 ? '' : 's'}`}
      hits={hits}
    />
  );
}

function ChunkDetail({ part }: { part: ToolView }) {
  if (part.state !== 'output-available') {
    return <ToolPending name="get_chunk" part={part} />;
  }
  const hit = normalizeHit(part.output);
  if (!hit) return <GenericTool part={part} name="get_chunk" />;
  const body = typeof (part.output as { body?: string })?.body === 'string'
    ? (part.output as { body: string }).body
    : hit.snippet;
  return (
    <HitList
      icon={<FileCode className="size-3.5" />}
      title="Chunk"
      hits={[{ ...hit, snippet: body }]}
      defaultOpen
    />
  );
}

function GrepResults({ title, part }: { title: string; part: ToolView }) {
  if (part.state !== 'output-available') {
    return <ToolPending name={title.toLowerCase()} part={part} />;
  }
  const matches: GrepMatch[] = Array.isArray(part.output) ? (part.output as GrepMatch[]) : [];
  const pattern =
    part.input && typeof part.input === 'object'
      ? ((part.input as { pattern?: string; symbol?: string }).pattern ??
        (part.input as { symbol?: string }).symbol)
      : undefined;

  return (
    <Collapsible
      icon={<Search className="size-3.5" />}
      title={`${matches.length} ${title.toLowerCase()} match${matches.length === 1 ? '' : 's'}${pattern ? ` for “${pattern}”` : ''}`}
      defaultOpen
    >
      <div className="grid gap-2">
        {matches.map((m, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              {m.repo && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                  {m.repo}
                </span>
              )}
              <span className="truncate font-mono">{m.path}</span>
              {m.line != null && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                  :{m.line}
                </span>
              )}
              <CopyButton
                text={m.path && m.line ? `${m.path}:${m.line}` : (m.path ?? '')}
                className="ml-auto shrink-0"
                label="Copy"
              />
            </div>
            {m.text && (
              <div className="px-3 py-2 font-mono text-xs text-foreground/90">{m.text}</div>
            )}
          </div>
        ))}
      </div>
    </Collapsible>
  );
}

function FileContent({ part }: { part: ToolView }) {
  if (part.state !== 'output-available') {
    return <ToolPending name="read_file" part={part} />;
  }
  const out = part.output as { content?: string; start_line?: number; end_line?: number } | string;
  const content = typeof out === 'string' ? out : (out.content ?? '');
  const path =
    part.input && typeof part.input === 'object'
      ? ((part.input as { path?: string }).path ?? 'file')
      : 'file';
  const lang = langFromPath(path);
  const range =
    typeof out === 'object' && out.start_line
      ? `:${out.start_line}-${out.end_line ?? out.start_line}`
      : '';

  return (
    <Collapsible
      icon={<FileCode className="size-3.5" />}
      title={
        <span className="font-mono">
          {path}
          {range}
        </span>
      }
      defaultOpen
    >
      <div className="text-xs">
        <Response>{`\`\`\`${lang}\n${content}\n\`\`\``}</Response>
      </div>
    </Collapsible>
  );
}

function FileList({ title, part }: { title: string; part: ToolView }) {
  if (part.state !== 'output-available') {
    return <ToolPending name={title} part={part} />;
  }
  const items = Array.isArray(part.output) ? part.output : [];
  return (
    <Collapsible
      icon={<FolderTree className="size-3.5" />}
      title={`${items.length} ${title} result${items.length === 1 ? '' : 's'}`}
      defaultOpen
    >
      <ul className="max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
        {items.map((item, i) => (
          <li key={i} className="truncate text-foreground/90">
            {formatListItem(item)}
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

function ReposList({ part }: { part: ToolView }) {
  if (part.state !== 'output-available') {
    return <ToolPending name="repos" part={part} />;
  }
  const repos = Array.isArray(part.output) ? part.output : [];
  return (
    <Collapsible icon={<FolderTree className="size-3.5" />} title={`${repos.length} repos`} defaultOpen>
      <ul className="space-y-1 text-xs">
        {repos.map((r, i) => {
          const row = r as { key?: string; root?: string };
          return (
            <li key={i} className="font-mono">
              <span className="text-foreground">{row.key}</span>
              {row.root && <span className="text-muted-foreground"> — {row.root}</span>}
            </li>
          );
        })}
      </ul>
    </Collapsible>
  );
}

function TextOutput({ title, part }: { title: string; part: ToolView }) {
  if (part.state !== 'output-available') {
    return <ToolPending name={title} part={part} />;
  }
  const out = part.output;
  const text =
    typeof out === 'string'
      ? out
      : out && typeof out === 'object' && 'content' in out
        ? String((out as { content: unknown }).content)
        : out && typeof out === 'object' && 'output' in out
          ? String((out as { output: unknown }).output)
          : JSON.stringify(out, null, 2);
  const icon = title.startsWith('git') ? (
    <GitBranch className="size-3.5" />
  ) : (
    <Terminal className="size-3.5" />
  );

  return (
    <Collapsible icon={icon} title={<span className="font-mono">{title}</span>} defaultOpen>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 font-mono text-xs text-foreground/80">
        {text}
      </pre>
    </Collapsible>
  );
}

function GenericTool({ part, name }: { part: ToolView; name: string }) {
  return (
    <Collapsible
      icon={<Wrench className="size-3.5" />}
      title={<span className="font-mono">{name}</span>}
    >
      <div className="space-y-2">
        {part.input !== undefined && <JsonBlock label="input" value={part.input} />}
        {part.output !== undefined && <JsonBlock label="output" value={part.output} />}
      </div>
    </Collapsible>
  );
}

function HitList({
  icon,
  title,
  hits,
  defaultOpen = true,
}: {
  icon: ReactNode;
  title: string;
  hits: Hit[];
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible icon={icon} title={title} defaultOpen={defaultOpen}>
      <div className="grid gap-2">
        {hits.map((hit, i) => (
          <SourceCard key={hit.id ?? i} hit={hit} />
        ))}
      </div>
    </Collapsible>
  );
}

function SourceCard({ hit }: { hit: Hit }) {
  const path = hit.path ?? '';
  const lang = langFromPath(path);
  const lines =
    hit.lines ??
    (hit.start_line != null
      ? `${hit.start_line}-${hit.end_line ?? hit.start_line}`
      : undefined);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
        {hit.repo && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            {hit.repo}
          </span>
        )}
        <span className="truncate font-mono text-foreground" title={path}>
          {path}
        </span>
        {lines && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
            :{lines}
          </span>
        )}
        {hit.score != null && (
          <span className="shrink-0 text-muted-foreground">{hit.score.toFixed(3)}</span>
        )}
        <CopyButton
          text={lines ? `${path}:${lines}` : path}
          className="ml-auto shrink-0"
          label="Copy path"
        />
      </div>
      {hit.symbol && (
        <div className="px-3 pt-2 font-mono text-xs text-muted-foreground">{hit.symbol}</div>
      )}
      {hit.kind && (
        <div className="px-3 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {hit.kind}
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

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto rounded-md bg-background p-2 font-mono text-xs text-foreground/80">
        {text}
      </pre>
    </div>
  );
}

function inputQuery(part: ToolView): string | undefined {
  return part.input && typeof part.input === 'object'
    ? (part.input as { query?: string }).query
    : undefined;
}

function normalizeHits(output: unknown): Hit[] {
  if (!Array.isArray(output)) return [];
  return output.map(normalizeHit).filter((h): h is Hit => h != null);
}

function normalizeHit(raw: unknown): Hit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const path = typeof r.path === 'string' ? r.path : '';
  if (!path) return null;
  return {
    id: r.id as number | string | undefined,
    repo: typeof r.repo === 'string' ? r.repo : undefined,
    path,
    symbol: typeof r.symbol === 'string' ? r.symbol : undefined,
    kind: typeof r.kind === 'string' ? r.kind : undefined,
    start_line: Number(r.start_line ?? 0) || undefined,
    end_line: Number(r.end_line ?? 0) || undefined,
    lines:
      r.start_line != null
        ? `${r.start_line}-${r.end_line ?? r.start_line}`
        : undefined,
    score: r.score != null ? Number(r.score) : undefined,
    snippet:
      typeof r.snippet === 'string'
        ? r.snippet
        : typeof r.body === 'string'
          ? r.body.slice(0, 400)
          : undefined,
  };
}

function formatListItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item);
  const o = item as Record<string, unknown>;
  if (typeof o.path === 'string') {
    const repo = typeof o.repo === 'string' && o.repo ? `[${o.repo}] ` : '';
    return `${repo}${o.path}`;
  }
  if (typeof o.name === 'string') {
    const dir = o.is_dir ? '/' : '';
    return `${o.name}${dir}`;
  }
  return JSON.stringify(item);
}
