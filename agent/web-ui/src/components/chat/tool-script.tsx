import { SquareTerminal } from 'lucide-react';

import { Collapsible } from '../ui';

import type { ToolView } from './message';

type ScriptOutput = {
  exit_code?: number | null;
  output?: string;
  output_file?: string;
  output_bytes?: number;
  output_preview?: string;
  tool_calls?: number;
  timed_out?: boolean;
  error?: string;
};

type ScriptRunProps = { part: ToolView };

/** `run_script`: the Python the agent wrote and what it printed. */
export function ScriptRun({ part }: ScriptRunProps) {
  const code = (part.input as { code?: string } | undefined)?.code ?? '';
  const out = (part.output ?? {}) as ScriptOutput;

  return (
    <Collapsible icon={<SquareTerminal className="size-3.5" />} title={scriptTitle(out)}>
      <div className="space-y-2">
        <ScriptBlock label="script" text={code} />
        {out.output_file ? <ScriptFile out={out} /> : <ScriptBlock label="output" text={out.error ?? out.output ?? ''} />}
      </div>
    </Collapsible>
  );
}

function scriptTitle(out: ScriptOutput): string {
  const calls = out.tool_calls ?? 0;

  const status = out.error
    ? 'failed to start'
    : out.timed_out
      ? 'timed out'
      : out.exit_code === 0
        ? 'finished'
        : `exited ${out.exit_code ?? 'abnormally'}`;

  return `Script ${status} · ${calls} tool call${calls === 1 ? '' : 's'}`;
}

/** Output written to a file: where it is, how big, and the preview the agent saw. */
function ScriptFile({ out }: { out: ScriptOutput }) {
  return (
    <>
      <div className="text-xs text-muted-foreground">
        Output saved to <span className="break-all font-mono text-foreground/80">{out.output_file}</span>
        {` (${formatBytes(out.output_bytes ?? 0)})`}
      </div>
      <ScriptBlock label="output preview" text={out.output_preview ?? ''} />
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function ScriptBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background p-2 font-mono text-xs text-foreground/80">
        {text || '(empty)'}
      </pre>
    </div>
  );
}
