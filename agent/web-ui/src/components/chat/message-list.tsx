import type { UIMessage } from 'ai';
import { memo } from 'react';

import { Message } from './message';
import { markerId } from '@/lib/message-rail';

/** Draft edits must not revisit the transcript or its markdown renderer. */
export const MessageList = memo(function MessageList({
  messages,
  sessionId,
  learningEnabled,
  busy,
  onRegenerate,
  onBranch,
}: {
  messages: UIMessage[];
  sessionId: string;
  learningEnabled: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onBranch?: (throughIndex: number) => void;
}) {
  return messages.map((message, index) => (
    <Message
      key={message.id || `${message.role}-${index}`}
      message={message}
      domId={markerId(message, index)}
      conversationId={sessionId}
      learningEnabled={learningEnabled && !busy}
      onRegenerate={!busy && message.role === 'assistant' && index === messages.length - 1 ? onRegenerate : undefined}
      onBranch={!busy && onBranch ? () => onBranch(index) : undefined}
    />
  ));
});
