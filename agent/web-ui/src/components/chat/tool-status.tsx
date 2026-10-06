import { Loader2, Wrench } from 'lucide-react';

import { Collapsible } from '../ui';
import { spilledToolTitle } from '../../lib/tool-output';
import {
  type SpilledOutputProps,
  type ToolPendingProps,
  type ToolErrorProps,
  type GenericToolProps,
  type JsonBlockProps,
} from './tool-views';

export function SpilledOutput({ name, output }: SpilledOutputProps) {
  return (
    <Collapsible icon={<Wrench className="size-3.5" />} title={spilledToolTitle(name, output)}>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 font-mono text-xs text-foreground/80">
        {output}
      </pre>
    </Collapsible>
  );
}

export function ToolPending({ name, part }: ToolPendingProps) {
  const query =
    part.input && typeof part.input === 'object'
      ? (part.input as { query?: string; pattern?: string; name?: string; symbol?: string })
      : undefined;
  const label =
    query?.query ??
    query?.pattern ??
    query?.name ??
    query?.symbol ??
    (part.input && typeof part.input === 'object' ? ((part.input as { path?: string }).path ?? '') : '');

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

export function ToolError({ name, message }: ToolErrorProps) {
  return (
    <div className="my-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <span className="font-mono">{name}</span>: {message}
    </div>
  );
}

export function GenericTool({ part, name }: GenericToolProps) {
  return (
    <Collapsible icon={<Wrench className="size-3.5" />} title={<span className="font-mono">{name}</span>}>
      <div className="space-y-2">
        {part.input !== undefined && <JsonBlock label="input" value={part.input} />}
        {part.output !== undefined && <JsonBlock label="output" value={part.output} />}
      </div>
    </Collapsible>
  );
}

export function JsonBlock({ label, value }: JsonBlockProps) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="overflow-x-auto rounded-md bg-background p-2 font-mono text-xs text-foreground/80">{text}</pre>
    </div>
  );
}
