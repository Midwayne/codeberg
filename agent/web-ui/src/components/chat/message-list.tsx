import { CanvasConversation, canvasAnchor, canvasEditing } from '../../canvas/conversation';
import type { UIMessage } from 'ai';
import { Fragment, memo } from 'react';

import { BranchMarker } from './branch-marker';
import { Message } from './message';
import { markerId } from '../../lib/message-rail';

/** Draft edits must not revisit the transcript or its markdown renderer. */
export const MessageList = memo(function MessageList({
  messages,
  sessionId,
  learningEnabled,
  busy,
  onRegenerate,
  onBranch,
  branch,
}: {
  messages: UIMessage[];
  sessionId: string;
  learningEnabled: boolean;
  busy: boolean;
  onRegenerate: () => void;
  onBranch?: (throughIndex: number) => void;
  branch?: { parentTitle: string; messageCount: number };
}) {
  return (
    <CanvasConversation.Provider value={{ chatId: sessionId, anchor: canvasAnchor(messages), editing: busy && canvasEditing(messages) }}>
      {messages.map((message, index) => (
        <Fragment key={message.id || `${message.role}-${index}`}>
          <Message
            message={message}
            domId={markerId(message, index)}
            conversationId={sessionId}
            learningEnabled={learningEnabled && !busy}
            onRegenerate={!busy && message.role === 'assistant' && index === messages.length - 1 ? onRegenerate : undefined}
            onBranch={!busy && onBranch ? () => onBranch(index) : undefined}
          />

          {branch && index === branch.messageCount - 1 && <BranchMarker parentTitle={branch.parentTitle} />}
        </Fragment>
      ))}
    </CanvasConversation.Provider>
  );
});
