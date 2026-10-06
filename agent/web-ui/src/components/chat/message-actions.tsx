import { FeedbackActions } from './message-feedback';
import { GitBranch, RefreshCw } from 'lucide-react';

import { CopyButton, IconButton } from '../ui';

import { cn } from '../../lib/utils';
import { type MessageActionsProps, type AnyPart } from './message';

export function MessageActions({
  message,
  onRegenerate,
  onBranch,
  conversationId,
  learningEnabled,
}: MessageActionsProps) {
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
