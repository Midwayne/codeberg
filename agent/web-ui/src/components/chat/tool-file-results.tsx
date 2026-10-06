import { FileCode, FolderTree, GitBranch, Terminal } from 'lucide-react';
import { Response } from './response';

import { Collapsible } from '../ui';
import { langFromPath } from '../../lib/utils';

import { type FileContentProps, type FileListProps, type ReposListProps, type TextOutputProps } from './tool-views';

export function FileContent({ part }: FileContentProps) {
  const out = part.output as { content?: string; start_line?: number; end_line?: number } | string;
  const content = typeof out === 'string' ? out : (out.content ?? '');
  const path =
    part.input && typeof part.input === 'object' ? ((part.input as { path?: string }).path ?? 'file') : 'file';
  const lang = langFromPath(path);
  const range = typeof out === 'object' && out.start_line ? `:${out.start_line}-${out.end_line ?? out.start_line}` : '';

  return (
    <Collapsible
      icon={<FileCode className="size-3.5" />}
      title={
        <span className="font-mono">
          {path}
          {range}
        </span>
      }
    >
      <div className="text-xs">
        <Response>{`\`\`\`${lang}\n${content}\n\`\`\``}</Response>
      </div>
    </Collapsible>
  );
}

export function FileList({ title, part }: FileListProps) {
  const items = Array.isArray(part.output) ? part.output : [];
  return (
    <Collapsible
      icon={<FolderTree className="size-3.5" />}
      title={`${items.length} ${title} result${items.length === 1 ? '' : 's'}`}
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

export function ReposList({ part }: ReposListProps) {
  const repos = Array.isArray(part.output) ? part.output : [];
  return (
    <Collapsible icon={<FolderTree className="size-3.5" />} title={`${repos.length} repos`}>
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

export function TextOutput({ title, part }: TextOutputProps) {
  const out = part.output;
  const text =
    typeof out === 'string'
      ? out
      : out && typeof out === 'object' && 'content' in out
        ? String((out as { content: unknown }).content)
        : out && typeof out === 'object' && 'output' in out
          ? String((out as { output: unknown }).output)
          : JSON.stringify(out, null, 2);
  const icon = title.startsWith('git') ? <GitBranch className="size-3.5" /> : <Terminal className="size-3.5" />;

  return (
    <Collapsible icon={icon} title={<span className="font-mono">{title}</span>}>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 font-mono text-xs text-foreground/80">
        {text}
      </pre>
    </Collapsible>
  );
}

export function formatListItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return String(item);
  const o = item as Record<string, unknown>;
  if (typeof o.path === 'string' && typeof o.depth === 'number') {
    const indent = '  '.repeat(Math.max(0, Number(o.depth)));
    const suffix = o.is_dir ? '/' : '';
    return `${indent}${o.path}${suffix}`;
  }
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
