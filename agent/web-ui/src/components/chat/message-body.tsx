import { isCanvasDrawing } from '../../canvas/conversation';
import { Brain, Loader2, Wrench } from 'lucide-react';

import { Response } from './response';
import { ToolViewRouter } from './tool-views';
import { Collapsible } from '../ui';
import { userPromptText } from '../../lib/message-rail';
import { cn } from '../../lib/utils';
import {
  type AttachmentProps,
  type AnyPart,
  type ActivityGroupProps,
  type ToolView,
  type PartProps,
  type ReasoningProps,
  type Message,
} from './message';

export function Attachment({ file }: AttachmentProps) {
  const name = file.filename ?? file.mediaType;
  // Saved sessions may contain arbitrary URLs; only preview local embedded attachments.
  const url = file.url.startsWith(`data:${file.mediaType};base64,`) ? file.url : undefined;
  return (
    <div className="mt-2 text-xs">
      {url && file.mediaType.startsWith('image/') ? (
        <img src={url} alt={name} className="max-h-64 max-w-full rounded-lg" />
      ) : url && file.mediaType.startsWith('audio/') ? (
        <audio controls src={url} aria-label={name} className="max-w-full" />
      ) : url && file.mediaType.startsWith('video/') ? (
        <video controls src={url} aria-label={name} className="max-h-64 max-w-full" />
      ) : null}
      <span className="break-all">{name}</span>
    </div>
  );
}

export function isToolPart(part: AnyPart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

export function isActivityPart(part: AnyPart): boolean {
  return part.type === 'reasoning' || (isToolPart(part) && !isCanvasDrawing(part as ToolView));
}

export function ActivityGroup({ parts }: ActivityGroupProps) {
  const toolCount = parts.filter(isToolPart).length;
  const reasoningCount = parts.length - toolCount;
  const title = [
    toolCount && `${toolCount} tool call${toolCount === 1 ? '' : 's'}`,
    reasoningCount && `${reasoningCount} reasoning trace${reasoningCount === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const running = parts.some((part) => {
    if (!isToolPart(part)) return false;
    const state = (part as ToolView).state;
    return state !== 'output-available' && state !== 'output-error';
  });
  return (
    <Collapsible
      icon={running ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
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

export function Part({ part }: PartProps) {
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

export function Reasoning({ text }: ReasoningProps) {
  if (!text?.trim()) return null;
  return (
    <Collapsible icon={<Brain className="size-3.5" />} title="Reasoning">
      <Response className="space-y-2 text-xs leading-relaxed text-muted-foreground">{text}</Response>
    </Collapsible>
  );
}

export type MessageBodyProps = Pick<Parameters<typeof Message>[0], 'message'> & {
  isUser: boolean;
  firstActivityIndex: number;
  activityParts: AnyPart[];
};

export function MessageBody({ isUser, message, firstActivityIndex, activityParts }: MessageBodyProps) {
  return (
    <div
      className={cn(
        'min-w-0 max-w-full',
        isUser ? 'rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap' : 'w-full space-y-2',
      )}
    >
      {isUser ? (
        <>
          {userPromptText(message)}
          {message.parts
            .filter((part) => part.type === 'file')
            .map((part, index) => (
              <Attachment key={index} file={part as Extract<AnyPart, { type: 'file' }>} />
            ))}
        </>
      ) : (
        message.parts.map((part, i) =>
          isActivityPart(part) ? (
            i === firstActivityIndex ? (
              <ActivityGroup key="activity" parts={activityParts} />
            ) : null
          ) : (
            <Part key={i} part={part} />
          ),
        )
      )}
    </div>
  );
}
