import { FileCode } from 'lucide-react';
import { Response } from './response';

import { Collapsible, CopyButton } from '../ui';
import { type HybridHit } from '@agent/core/evidence-extract.js';
import { formatLineRange } from '@agent/core/search-hit.js';
import { langFromPath } from '../../lib/utils';

import { type HitListProps, type SourceCardProps } from './tool-views';

export type DisplayHit = HybridHit;

export function HitList({ icon, title, hits }: HitListProps) {
  return (
    <Collapsible icon={icon} title={title}>
      <div className="grid gap-2">
        {hits.map((hit, i) => (
          <SourceCard key={`${hit.repo ?? ''}:${hit.path}:${hit.start_line}:${i}`} hit={hit} />
        ))}
      </div>
    </Collapsible>
  );
}

export function SourceCard({ hit }: SourceCardProps) {
  const path = hit.path;
  const lang = langFromPath(path);
  const lines = formatLineRange(hit);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <FileCode className="size-3.5 shrink-0 text-muted-foreground" />
        {hit.repo && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">{hit.repo}</span>
        )}
        <span className="truncate font-mono text-foreground" title={path}>
          {path}
        </span>
        {lines && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">:{lines}</span>
        )}
        {hit.score != null && <span className="shrink-0 text-muted-foreground">{hit.score.toFixed(3)}</span>}
        {hit.grep_boost != null && hit.grep_boost > 0 && (
          <span className="shrink-0 text-muted-foreground">+{hit.grep_boost} lex</span>
        )}
        <CopyButton text={lines ? `${path}:${lines}` : path} className="ml-auto shrink-0" label="Copy path" />
      </div>
      {hit.symbol && <div className="px-3 pt-2 font-mono text-xs text-muted-foreground">{hit.symbol}</div>}
      {hit.snippet && (
        <div className="px-3 py-2 text-xs">
          <Response>{`\`\`\`${lang}\n${hit.snippet}\n\`\`\``}</Response>
        </div>
      )}
    </div>
  );
}
