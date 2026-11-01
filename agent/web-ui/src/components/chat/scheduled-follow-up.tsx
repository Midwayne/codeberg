import { Clock } from 'lucide-react';
import type { UIMessage } from 'ai';
import { userPromptText } from '../../lib/message-rail';

export function ScheduledFollowUp({ message }: { message: UIMessage }) {
  return <div className="min-w-0 max-w-full text-xs text-muted-foreground">
    <p className="flex items-center gap-2">
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      Resuming scheduled task…
    </p>
    <details className="min-w-0 max-w-full">
      <summary className="min-h-11 w-fit cursor-pointer py-3 hover:text-foreground">Task details</summary>
      <p className="max-w-prose whitespace-pre-wrap pb-2 leading-6 [overflow-wrap:anywhere]">{userPromptText(message)}</p>
    </details>
  </div>;
}
