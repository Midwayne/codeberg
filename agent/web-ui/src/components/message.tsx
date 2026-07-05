import { RefreshCw } from 'lucide-react';
import type { UIMessage } from 'ai';

import { Response } from '@/components/response';
import { ToolViewRouter } from '@/components/tool-views';
import { CopyButton, IconButton } from '@/components/ui';
import { cn } from '@/lib/utils';

type AnyPart = UIMessage['parts'][number];

/** Loose view over the tool-part union (`tool-<name>` and `dynamic-tool`). */
export interface ToolView {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function Message({
  message,
  onRegenerate,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('group/message flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'min-w-0 max-w-full',
          isUser
            ? 'rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap'
            : 'w-full space-y-2',
        )}
      >
        {isUser ? userText(message) : message.parts.map((part, i) => <Part key={i} part={part} />)}
      </div>
      {!isUser && message.parts.length > 0 && (
        <MessageActions message={message} onRegenerate={onRegenerate} />
      )}
    </div>
  );
}

function Part({ part }: { part: AnyPart }) {
  if (part.type === 'text') {
    return part.text ? <Response>{part.text}</Response> : null;
  }
  if (part.type === 'reasoning') {
    return <Reasoning text={part.text} />;
  }
  if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
    return <ToolViewRouter part={part as unknown as ToolView} />;
  }
  return null;
}

function Reasoning({ text }: { text: string }) {
  if (!text?.trim()) return null;
  return (
    <div className="rounded-lg border border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground italic">
      {text}
    </div>
  );
}

function MessageActions({
  message,
  onRegenerate,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
}) {
  const text = message.parts
    .filter((p): p is Extract<AnyPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
      {text && <CopyButton text={text} />}
      {onRegenerate && (
        <IconButton onClick={onRegenerate} aria-label="Regenerate" title="Regenerate">
          <RefreshCw className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}

function userText(message: UIMessage) {
  return message.parts
    .filter((p): p is Extract<AnyPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
