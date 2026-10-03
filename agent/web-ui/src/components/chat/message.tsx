import { Brain, ChevronDown, CircleAlert, GitBranch, Loader2, RefreshCw, Wrench } from 'lucide-react';
import type { UIMessage } from 'ai';
import { useEffect, useRef, useState } from 'react';

import { Response } from './response';
import { ToolViewRouter } from './tool-views';
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
          ? <>{userPromptText(message)}{message.parts.filter((part) => part.type === 'file').map((part, index) => (
              <Attachment key={index} file={part as Extract<AnyPart, { type: 'file' }>} />
            ))}</>
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

function Attachment({ file }: { file: Extract<AnyPart, { type: 'file' }> }) {
  const name = file.filename ?? file.mediaType;
  // Saved sessions may contain arbitrary URLs; only preview local embedded attachments.
  const url = file.url.startsWith(`data:${file.mediaType};base64,`) ? file.url : undefined;
  return <div className="mt-2 text-xs">
    {url && file.mediaType.startsWith('image/') ? <img src={url} alt={name} className="max-h-64 max-w-full rounded-lg" /> :
      url && file.mediaType.startsWith('audio/') ? <audio controls src={url} aria-label={name} className="max-w-full" /> :
        url && file.mediaType.startsWith('video/') ? <video controls src={url} aria-label={name} className="max-h-64 max-w-full" /> : null}
    <span className="break-all">{name}</span>
  </div>;
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
    <div role="group" aria-label="Rate this answer" aria-busy={saving} className="ml-1 flex flex-wrap items-center gap-2">
      <div className="relative">
        <select
          aria-label="Rate this answer"
          value={selected ?? ''}
          disabled={saving}
          onChange={(event) => {
            const option = FEEDBACK_OPTIONS.find((entry) => entry.label === event.currentTarget.value);
            if (option) void choose(option);
          }}
          className={cn(
            'peer min-h-11 w-40 appearance-none rounded-md border border-transparent bg-background py-2 pl-2 pr-7 text-base text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 sm:min-h-9 sm:text-xs',
            selected && 'text-foreground',
          )}
        >
          <option value="" disabled={selected !== undefined} className="bg-popover text-popover-foreground">Rate answer</option>
          {FEEDBACK_OPTIONS.map((option) => (
            <option key={option.label} value={option.label} className="bg-popover text-popover-foreground">{option.title}</option>
          ))}
        </select>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground peer-hover:text-accent-foreground peer-focus-visible:text-accent-foreground peer-disabled:opacity-60" />
      </div>
      {saving && <span role="status" className="sr-only">Saving rating…</span>}
      {failed && (
        <span role="status" className="inline-flex max-w-48 items-start gap-1.5 text-xs text-destructive">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Feedback wasn't saved. Select a rating to retry.
        </span>
      )}
    </div>
  );
}
