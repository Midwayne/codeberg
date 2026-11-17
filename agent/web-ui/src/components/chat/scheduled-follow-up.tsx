import { ChevronDown, Clock } from 'lucide-react';
import type { UIMessage } from 'ai';
import { userPromptText } from '../../lib/message-rail';

/** A scheduled wake-up reads as a timeline event, not a user bubble; its prompt stays collapsed. */
export function ScheduledFollowUp({ message }: { message: UIMessage }) {
  return (
    <details className="group/task w-full min-w-0 text-xs text-muted-foreground">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 md:min-h-8 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />

        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 transition-colors group-hover/task:text-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          Resuming scheduled task…
          <span aria-hidden="true" className="opacity-50">·</span>
          Task details
          <ChevronDown
            className="size-3.5 shrink-0 transition-transform group-open/task:rotate-180"
            aria-hidden="true"
          />
        </span>

        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </summary>

      <p className="mx-auto mt-2 max-w-prose rounded-lg border border-border bg-card/40 px-3 py-2 whitespace-pre-wrap leading-5 [overflow-wrap:anywhere]">
        {userPromptText(message)}
      </p>
    </details>
  );
}
