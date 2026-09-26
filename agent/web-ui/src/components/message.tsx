import { Brain, CircleAlert, GitBranch, Loader2, RefreshCw, Wrench } from 'lucide-react';
import type { UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';

import { Response } from '@/components/response';
import { ToolViewRouter } from '@/components/tool-views';
import { Collapsible, CopyButton, IconButton } from '@/components/ui';
import { userPromptText } from '@/lib/message-rail';
import { cn } from '@/lib/utils';
import {
  FEEDBACK_OPTIONS,
  loadFeedback,
  rateAttempt,
  type FeedbackOption,
} from '@/lib/learning';

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
  conversationId,
  learningEnabled = true,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
  onBranch?: () => void;
  /** Stable id written to the DOM so the tick rail can scroll here. */
  domId?: string;
  conversationId?: string;
  learningEnabled?: boolean;
}) {
  const isUser = message.role === 'user';
  const showActions = Boolean(onRegenerate || onBranch || (!isUser && message.parts.length > 0));
  const activityParts = isUser ? [] : message.parts.filter(isActivityPart);
  const firstActivityIndex = isUser ? -1 : message.parts.findIndex(isActivityPart);
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
        {isUser
          ? userPromptText(message)
          : message.parts.map((part, i) =>
              isActivityPart(part) ? (
                i === firstActivityIndex ? <ActivityGroup key="activity" parts={activityParts} /> : null
              ) : (
                <Part key={i} part={part} />
              ),
            )}
      </div>
      {showActions && (
        <MessageActions
          message={message}
          conversationId={conversationId}
          learningEnabled={learningEnabled}
          onRegenerate={onRegenerate}
          onBranch={onBranch}
        />
      )}
    </div>
  );
}

function isToolPart(part: AnyPart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function isActivityPart(part: AnyPart): boolean {
  return part.type === 'reasoning' || isToolPart(part);
}

function ActivityGroup({ parts }: { parts: AnyPart[] }) {
  const toolCount = parts.filter(isToolPart).length;
  const reasoningCount = parts.length - toolCount;
  const title = [
    toolCount && `${toolCount} tool call${toolCount === 1 ? '' : 's'}`,
    reasoningCount && `${reasoningCount} reasoning trace${reasoningCount === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ');
  const running = parts.some((part) => {
    if (!isToolPart(part)) return false;
    const state = (part as ToolView).state;
    return state !== 'output-available' && state !== 'output-error';
  });
  return (
    <Collapsible
      icon={
        running ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />
      }
      title={title}
      badge={running ? <span>Running…</span> : undefined}
    >
      <div className="space-y-1">
        {parts.map((part, i) =>
          isToolPart(part) ? (
            <ToolViewRouter
              key={'toolCallId' in part ? `tool:${String(part.toolCallId)}` : `tool:${i}`}
              part={part as ToolView}
            />
          ) : (
            <Part key={`reasoning:${i}`} part={part} />
          ),
        )}
      </div>
    </Collapsible>
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
  conversationId,
  learningEnabled,
}: {
  message: UIMessage;
  onRegenerate?: () => void;
  onBranch?: () => void;
  conversationId?: string;
  learningEnabled: boolean;
}) {
  const isUser = message.role === 'user';
  const text = message.parts
    .filter((p): p is Extract<AnyPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100',
        isUser ? 'opacity-0' : 'opacity-100',
        isUser && 'flex-row-reverse',
      )}
    >
      {!isUser && text && <CopyButton text={text} />}
      {!isUser && learningEnabled && conversationId && (
        <FeedbackActions conversationId={conversationId} messageId={message.id} />
      )}
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

function FeedbackActions({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const [selected, setSelected] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    savingRef.current = false;
    setSaving(false);
    setSelected(undefined);
    setFailed(false);
    void loadFeedback(conversationId, messageId).then((feedback) => {
      if (request === generation.current && !savingRef.current) setSelected(feedback?.label);
    });
    return () => {
      generation.current++;
    };
  }, [conversationId, messageId]);

  async function choose(option: FeedbackOption): Promise<void> {
    if (savingRef.current) return;
    savingRef.current = true;
    const request = ++generation.current;
    const previous = selected;
    setSaving(true);
    setFailed(false);
    setSelected(option.label);
    try {
      const feedback = await rateAttempt(conversationId, messageId, option);
      if (request === generation.current) setSelected(feedback.label);
    } catch {
      if (request === generation.current) {
        setSelected(previous);
        setFailed(true);
      }
    } finally {
      if (request === generation.current) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <div role="group" aria-label="Rate this answer" aria-busy={saving} className="ml-1 flex items-center gap-0.5">
      <select
        aria-label="Rate this answer"
        value={selected ?? ''}
        disabled={saving}
        onChange={(event) => {
          const option = FEEDBACK_OPTIONS.find((entry) => entry.label === event.currentTarget.value);
          if (option) void choose(option);
        }}
        className={cn(
          'h-7 w-36 rounded-md border border-transparent bg-transparent px-1 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
          selected && 'text-foreground',
        )}
      >
        <option value="">Rate answer</option>
        {FEEDBACK_OPTIONS.map((option) => (
          <option key={option.label} value={option.label}>{option.title}</option>
        ))}
      </select>
      {failed && (
        <span title="Feedback wasn't saved; try again" role="status" aria-label="Feedback wasn't saved; try again">
          <CircleAlert className="size-3.5 text-destructive" />
        </span>
      )}
    </div>
  );
}
