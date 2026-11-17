import { SquareTerminal } from 'lucide-react';

import { Collapsible } from '../ui';

import type { ToolView } from './message';

type ScriptOutput = {
  exit_code?: number | null;
  output?: string;
  tool_calls?: number;
  timed_out?: boolean;
  truncated?: boolean;
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
        <ScriptBlock label="output" text={out.error ?? out.output ?? ''} />
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

  const truncated = out.truncated ? ', output truncated' : '';

  return `Script ${status} · ${calls} tool call${calls === 1 ? '' : 's'}${truncated}`;
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
