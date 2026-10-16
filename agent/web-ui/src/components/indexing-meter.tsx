import type { IndexProgress } from '../lib/project-api';

export function indexingPhase(progress?: IndexProgress): string {
  const labels: Record<string, string> = {
    counting: 'Counting chunks',
    graph: 'Building graph',
    embedding: 'Indexing chunks',
    finalizing: 'Finalizing search',
  };

  return labels[progress?.phase ?? 'counting'] ?? 'Preparing search';
}

export function IndexingMeter({ progress }: { progress?: IndexProgress }) {
  const total = progress?.total ?? 0;
  const completed = Math.max(0, Math.min(progress?.completed ?? 0, total));
  const unit = progress?.phase === 'graph' ? 'files' : 'chunks';
  const label = total > 0
    ? `${completed.toLocaleString()} / ${total.toLocaleString()} ${unit}`
    : `${indexingPhase(progress)}…`;

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
