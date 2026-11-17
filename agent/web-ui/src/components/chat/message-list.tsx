import { CanvasConversation, canvasAnchor, canvasEditing } from '../../canvas/conversation';
import type { UIMessage } from 'ai';
import { Fragment, memo, useMemo } from 'react';

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
  const anchor = canvasAnchor(messages);
  const editing = busy && canvasEditing(messages);
  // A new context object per token would re-render every canvas consumer.
  const canvas = useMemo(() => ({ chatId: sessionId, anchor, editing }), [sessionId, anchor, editing]);

  return (
    <CanvasConversation.Provider value={canvas}>
      {messages.map((message, index) => (
        <Fragment key={message.id || `${message.role}-${index}`}>
          <Message
            message={message}
            domId={markerId(message, index)}
            conversationId={sessionId}
            learningEnabled={learningEnabled && !busy}
            onRegenerate={!busy && message.role === 'assistant' && index === messages.length - 1 ? onRegenerate : undefined}
            onBranch={!busy ? onBranch : undefined}
            index={index}
          />

          {branch && index === branch.messageCount - 1 && <BranchMarker parentTitle={branch.parentTitle} />}
        </Fragment>
      ))}
    </CanvasConversation.Provider>
  );
});
