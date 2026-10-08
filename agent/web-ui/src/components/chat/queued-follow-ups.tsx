import { CornerUpRight, X } from 'lucide-react';

import type { QueuedTurn } from '../../sessions/turn-queue';
import type { useTurnQueue } from './use-turn-queue';

type QueueView = ReturnType<typeof useTurnQueue>;
type QueuedFollowUpsProps = { queue: QueueView; busy: boolean; failed: boolean };

export function QueuedFollowUps({ queue, busy, failed }: QueuedFollowUpsProps) {
  const { items, paused, error } = queue.snapshot;
  if (!items.length && !error) return null;

  return (
    <section aria-label="Queued follow-ups" className="mb-3 overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <span className="font-medium">Queued follow-ups · {items.length}</span>
        <span role="status" className="text-muted-foreground">
          {paused ? (failed ? 'Paused · retry the response to continue' : 'Paused') : 'Sent after the current response'}
        </span>
        {paused && !busy && !failed && <button type="button" onClick={queue.resume}
          className="ml-auto min-h-11 rounded-lg px-3 font-medium hover:bg-accent">Resume queue</button>}
      </div>
      {error && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{error}</p>}
      <ol className="max-h-44 overflow-y-auto">
        {items.map((item, index) => <QueuedRow key={item.id} item={item} index={index} queue={queue} busy={busy} />)}
      </ol>
    </section>
  );
}

function QueuedRow({ item, index, queue, busy }: { item: QueuedTurn; index: number; queue: QueueView; busy: boolean }) {
  return (
    <li className="flex items-center gap-3 border-t border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm" title={item.text}>
          {item.text || 'Attached files'}
        </p>
        {!!item.files?.length && <p className="mt-1 break-words text-xs text-muted-foreground">
          {Array.from(item.files).map((file) => file.name).join(', ')}
        </p>}
      </div>
      {busy && <button type="button" onClick={() => queue.steerQueued?.(item.id)}
        aria-label={`Steer with queued follow-up ${index + 1}`} title="Use this instruction now, interrupting the current response"
        disabled={queue.snapshot.steering}
        className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground before:absolute before:-inset-1.5 hover:bg-accent hover:text-foreground disabled:opacity-40">
        <CornerUpRight aria-hidden="true" className="size-3.5" />
      </button>}
      <button type="button" onClick={() => queue.remove?.(item.id)} aria-label={`Remove queued follow-up ${index + 1}`}
        className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground before:absolute before:-inset-1.5 hover:bg-accent hover:text-foreground">
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </li>
  );
}
