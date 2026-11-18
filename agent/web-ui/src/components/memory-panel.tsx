import { actionClass } from './button-styles';
import { LoadingBoundary } from './loading';
import { ErrorNotice } from './ui';

import type { MemoryDashboard, ProfileNote } from '../lib/memory';
import { useMemoryPanel } from '../lib/use-memory-panel';

export function MemoryPanel() {
  const state = useMemoryPanel();

  return (
    <section className="space-y-4 border-t border-border pt-6" aria-labelledby="memory-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h3 id="memory-heading" className="text-lg font-semibold">
            Saved memory
          </h3>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            What Codeberg has learned about how you work and about this codebase. New chats use it.
          </p>
        </div>
        <button type="button" className={actionClass} disabled={state.busy} onClick={state.refresh}>
          Refresh
        </button>
      </div>
      {state.error && <ErrorNotice title="Could not load saved memory" detail={state.error} onRetry={state.refresh} />}
      <LoadingBoundary loading={!state.dashboard && !state.error} label="Loading memory…" kind="list">
        {state.dashboard && <MemoryView dashboard={state.dashboard} busy={state.busy} onRemove={state.remove} />}
      </LoadingBoundary>
    </section>
  );
}

type MemoryViewProps = { dashboard: MemoryDashboard; busy: boolean; onRemove: (id: string) => void };

export function MemoryView({ dashboard, busy, onRemove }: MemoryViewProps) {
  return (
    <div className="space-y-5">
      <MemoryActivity dashboard={dashboard} />
      <div className="space-y-2">
        <h4 className="text-sm font-medium">How you work</h4>
        {dashboard.profile.length ? (
          <ul className="divide-y divide-border" aria-label="How you work">
            {dashboard.profile.map((note) => (
              <ProfileNoteItem key={note.id} note={note} busy={busy} onRemove={onRemove} />
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Nothing yet. Codeberg learns preferences you state in chats or in a rating reason, such as “keep answers
            short” or “I use pnpm”.
          </p>
        )}
      </div>
      <KnowledgeList dashboard={dashboard} />
    </div>
  );
}

type ProfileNoteItemProps = { note: ProfileNote; busy: boolean; onRemove: (id: string) => void };

function ProfileNoteItem({ note, busy, onRemove }: ProfileNoteItemProps) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
      <span className="min-w-0 flex-1 break-words">
        {note.statement}
        <span className="mt-1 block text-xs text-muted-foreground">
          <span className="capitalize">{note.kind}</span> · from “{note.evidence}”
        </span>
      </span>
      <button
        type="button"
        className={actionClass}
        disabled={busy}
        aria-label={`Remove note: ${note.statement}`}
        onClick={() => onRemove(note.id)}
      >
        Remove
      </button>
    </li>
  );
}

function KnowledgeList({ dashboard }: { dashboard: MemoryDashboard }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Codebase knowledge</h4>
      {dashboard.knowledge.length ? (
        <ul className="divide-y divide-border" aria-label="Codebase knowledge">
          {dashboard.knowledge.map((item) => (
            <li key={item.id} className="py-3 text-sm">
              <span className="break-words">{item.title}</span>
              <span className="mt-1 block text-xs capitalize text-muted-foreground">
                {item.category} · {item.status.replace('_', ' ')} ·{' '}
                {item.id.startsWith('confirmed-') ? 'confirmed answer, not source-verified' : `${item.confidence} confidence`} ·{' '}
                {usageLabel(item)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          Nothing yet. Rate an answer <strong>Solved</strong> to save it, or <strong>Mostly correct</strong> to save
          only what can be quoted from current code.
        </p>
      )}
    </div>
  );
}

function MemoryActivity({ dashboard }: { dashboard: MemoryDashboard }) {
  return (
    <>
      {dashboard.pending > 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving from {dashboard.pending} recent {dashboard.pending === 1 ? 'answer' : 'answers'}…
        </p>
      )}
      {dashboard.errors.map((item, index) => (
        <p key={index} role="alert" className="break-words text-sm text-destructive">
          {item.type === 'extract_profile' ? 'Learning how you work' : 'Saving knowledge'}{' '}
          {item.status === 'failed' ? 'failed' : 'will retry'}: {item.error} Check the learning model in Models.
        </p>
      ))}
    </>
  );
}

function usageLabel({ uses, last_used_at }: MemoryDashboard['knowledge'][number]): string {
  if (!uses) return 'not used yet';

  const last = last_used_at ? `, last ${new Date(last_used_at).toLocaleDateString()}` : '';

  return `used ${uses} ${uses === 1 ? 'time' : 'times'}${last}`;
}
