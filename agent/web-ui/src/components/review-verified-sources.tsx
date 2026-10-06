import { type ReviewDecisionForm } from './review-decision';

export type VerifiedSourcesProps = Pick<Parameters<typeof ReviewDecisionForm>[0], 'state'>;

export function VerifiedSources({ state }: VerifiedSourcesProps) {
  return (
    (state.destination === 'eval' || state.row.kind === 'hard_negative_candidates') && (
      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-xs font-medium">
          {state.row.kind === 'hard_negative_candidates' && state.destination === 'training'
            ? 'Which proposed results did you verify are wrong?'
            : 'Which sources did you independently verify?'}
        </p>
        {state.choices.map((hit) => (
          <label key={hit.path} className="flex min-h-11 cursor-pointer items-start gap-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={state.verified.includes(hit.path)}
              onChange={() => state.onVerified(hit.path)}
              className="size-5 shrink-0 accent-primary"
            />
            <span className="font-mono wrap-break-word">{hit.path}</span>
          </label>
        ))}
        {state.destination === 'eval' && (
          <label className="block text-xs text-muted-foreground">
            Other verified files (one per line, optional)
            <textarea
              value={state.otherPaths}
              onChange={(event) => state.onOtherPaths(event.currentTarget.value)}
              rows={2}
              placeholder="src/path/to/verified-file.ts"
              className="mt-1 w-full rounded-md border border-border bg-background p-3 font-mono text-base text-foreground sm:text-sm"
            />
          </label>
        )}
        {state.destination === 'eval' && state.row.kind !== 'retrieval' && (
          <label className="block text-xs text-muted-foreground">
            Checked expected outcome (if no file applies)
            <textarea
              value={state.expected}
              onChange={(event) => state.onExpected(event.currentTarget.value)}
              rows={2}
              maxLength={4000}
              placeholder="What should a correct result say?"
              className="mt-1 w-full rounded-md border border-border bg-background p-3 text-base text-foreground sm:text-sm"
            />
          </label>
        )}
      </div>
    )
  );
}
