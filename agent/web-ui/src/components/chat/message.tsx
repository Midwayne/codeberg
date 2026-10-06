import { MessageBody, isActivityPart } from './message-body';
import { MessageActions } from './message-actions';

import type { UIMessage } from 'ai';

import { cn } from '../../lib/utils';

export type AnyPart = UIMessage['parts'][number];

/** Loose view over the tool-part union (`tool-<name>` and `dynamic-tool`). */
export interface ToolView {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export type MessageProps = {
  message: UIMessage;
  onRegenerate?: () => void;
  onBranch?: () => void;
  /** Stable id written to the DOM so the tick rail can scroll here. */
  domId?: string;
  conversationId?: string;
  learningEnabled?: boolean;
};

export function Message({
  message,
  onRegenerate,
  onBranch,
  domId,
  conversationId,
  learningEnabled = true,
}: MessageProps) {
  const isUser = message.role === 'user';
  const showActions = Boolean(onRegenerate || onBranch || (!isUser && message.parts.length > 0));
  const activityParts = isUser ? [] : message.parts.filter(isActivityPart);
  const firstActivityIndex = isUser ? -1 : message.parts.findIndex(isActivityPart);
  return (
    <div
      data-message-id={domId ?? message.id}
      className={cn('group/message flex scroll-mt-3 flex-col gap-1', isUser ? 'items-end' : 'items-start')}
    >
      <MessageBody
        isUser={isUser}
        message={message}
        firstActivityIndex={firstActivityIndex}
        activityParts={activityParts}
      />
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

export type AttachmentProps = { file: Extract<AnyPart, { type: 'file' }> };

export type ActivityGroupProps = { parts: AnyPart[] };

export type PartProps = { part: AnyPart };

export type ReasoningProps = { text: string };

export type MessageActionsProps = {
  message: UIMessage;
  onRegenerate?: () => void;
  onBranch?: () => void;
  conversationId?: string;
  learningEnabled: boolean;
};
