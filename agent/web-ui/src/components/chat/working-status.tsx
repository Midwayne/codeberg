import { isToolUIPart, type ChatStatus, type UIMessage } from 'ai';

import './working-status.css';

type WorkingStatusProps = { status: ChatStatus; messages: UIMessage[]; steering?: boolean };
export function WorkingStatus({ status, messages, steering }: WorkingStatusProps) {
  if (!steering && status !== 'submitted' && status !== 'streaming') return null;
  if (!steering && status === 'streaming' && hasVisibleResponse(messages)) return null;

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-foreground">
      <ThinkingLabel />
    </div>
  );
}

function ThinkingLabel() {
  return (
    <span className="thinking-label">
      <span className="sr-only">Thinking…</span>
      <span aria-hidden="true">
        {Array.from('Thinking…').map((letter, index) => (
          <span key={index} className="thinking-letter" style={{ animationDelay: `${index * 70}ms` }}>{letter}</span>
        ))}
      </span>
    </span>
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
