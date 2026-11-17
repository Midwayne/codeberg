import { isToolUIPart, type ChatStatus, type UIMessage } from 'ai';

import { CubeLoader } from './cube-loader';
import { useElapsedSeconds } from './use-elapsed';
import { formatElapsed, workingPhase } from './working-phase';

import './working-status.css';

/* The waiting label changes every few seconds so long turns still feel alive. */
const LABEL_SECONDS = 4;

type WorkingStatusProps = { status: ChatStatus; messages: UIMessage[]; steering?: boolean };
export function WorkingStatus({ status, messages, steering }: WorkingStatusProps) {
  if (!steering && status !== 'submitted' && status !== 'streaming') return null;
  if (!steering && status === 'streaming' && hasVisibleResponse(messages)) return null;

  return <WorkingIndicator messages={messages} />;
}

type WorkingIndicatorProps = { messages: UIMessage[] };

function WorkingIndicator({ messages }: WorkingIndicatorProps) {
  const seconds = useElapsedSeconds();

  const phase = workingPhase(messages, Math.floor(seconds / LABEL_SECONDS));
  const elapsed = formatElapsed(seconds);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="working-status text-sm text-foreground">
      <span className="sr-only">Working…</span>
      <CubeLoader />
      <span aria-hidden="true" className="working-label" data-phase={phase.kind} key={phase.label}>
        {phase.label}…
      </span>
      {elapsed && <span aria-hidden="true" className="working-elapsed">{elapsed}</span>}
    </div>
  );
}

function hasVisibleResponse(messages: UIMessage[]): boolean {
  const latest = messages.at(-1);
  if (latest?.role !== 'assistant') return false;

  for (const part of [...latest.parts].reverse()) {
    if (isToolUIPart(part) && ['input-streaming', 'input-available'].includes(part.state)) {
      return false;
    }
    if (part.type === 'reasoning' && part.state === 'streaming') return false;
    if (part.type === 'text') return Boolean(part.text.trim());
  }

  return false;
}
