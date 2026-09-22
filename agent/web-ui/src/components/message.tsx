import { Brain, GitBranch, RefreshCw } from 'lucide-react';
import type { UIMessage } from 'ai';

import { Response } from '@/components/response';
import { ToolViewRouter } from '@/components/tool-views';
import { Collapsible, CopyButton, IconButton } from '@/components/ui';
import { userPromptText } from '@/lib/message-rail';
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
  onBranch,
  domId,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
  onBranch?: () => void;
  /** Stable id written to the DOM so the tick rail can scroll here. */
  domId?: string;
}) {
  const isUser = message.role === 'user';
  const showActions = Boolean(onRegenerate || onBranch || (!isUser && message.parts.length > 0));
  return (
    <div
      data-message-id={domId ?? message.id}
      className={cn(
        'group/message flex scroll-mt-3 flex-col gap-1',
        isUser ? 'items-end' : 'items-start',
      )}
    >
      <div
        className={cn(
          'min-w-0 max-w-full',
          isUser
            ? 'rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap'
            : 'w-full space-y-2',
        )}
      >
        {isUser ? userPromptText(message) : message.parts.map((part, i) => <Part key={i} part={part} />)}
      </div>
      {showActions && (
        <MessageActions message={message} onRegenerate={onRegenerate} onBranch={onBranch} />
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
    <Collapsible icon={<Brain className="size-3.5" />} title="Reasoning">
      <Response className="space-y-2 text-xs leading-relaxed text-muted-foreground">
        {text}
      </Response>
    </Collapsible>
  );
}

function MessageActions({
  message,
  onRegenerate,
  onBranch,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
  onBranch?: () => void;
}) {
  const isUser = message.role === 'user';
  const text = message.parts
    .filter((p): p is Extract<AnyPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100',
        isUser && 'flex-row-reverse',
      )}
    >
      {!isUser && text && <CopyButton text={text} />}
      {onBranch && (
        <IconButton onClick={onBranch} aria-label="Branch from here" title="Branch from here">
          <GitBranch className="size-3.5" />
        </IconButton>
      )}
      {onRegenerate && (
        <IconButton onClick={onRegenerate} aria-label="Regenerate" title="Regenerate">
          <RefreshCw className="size-3.5" />
        </IconButton>
      )}
    </div>
  );
}
