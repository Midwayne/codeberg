import type { IndexProgress } from '../lib/project-api';

export function indexingPhase(progress?: IndexProgress): string {
  const labels: Record<string, string> = {
    counting: 'Scanning files',
    graph: 'Building graph',
    embedding: 'Indexing chunks',
    finalizing: 'Finalizing search',
  };

  return labels[progress?.phase ?? 'counting'] ?? 'Preparing search';
}

/** Before the total is known the indexer reports how many files it has read. */
function scanningLabel(progress?: IndexProgress): string {
  const scanned = progress?.phase === 'counting' ? progress.completed : 0;
  if (scanned > 0) return `${scanned.toLocaleString()} files scanned`;

  return `${indexingPhase(progress)}…`;
}

export function IndexingMeter({ progress }: { progress?: IndexProgress }) {
  const total = progress?.total ?? 0;
  const completed = Math.max(0, Math.min(progress?.completed ?? 0, total));
  const unit = progress?.phase === 'graph' ? 'files' : 'chunks';
  const label = total > 0
    ? `${completed.toLocaleString()} / ${total.toLocaleString()} ${unit}`
    : scanningLabel(progress);

  return (
    <div className="space-y-2 px-3 pb-2">
      <p className="text-xs tabular-nums text-muted-foreground">{label}</p>
      {total > 0 && <div role="progressbar" aria-label={indexingPhase(progress)}
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed} aria-valuetext={label}
        className="h-1 overflow-hidden rounded-sm bg-muted">
        <div className="indexing-progress-bar h-full w-full rounded-sm bg-primary"
          style={{ transform: `scaleX(${completed / total})` }} />
      </div>}
    </div>
  );
}
