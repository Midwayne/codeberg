import { labels, buttonClass } from './settings-styles';

import { CleanupOptions } from './cleanup-options';
import { type CleanupConfirmationProps, type CleanupSelectionProps } from './cleanup';

export function CleanupConfirmation({
  confirming,
  count,
  selected,
  busy,
  remove,
  setConfirming,
}: CleanupConfirmationProps) {
  return (
    confirming && (
      <div className="space-y-3 rounded-xl border border-destructive p-4">
        <p className="text-sm">
          Permanently delete {count} matching files from {selected.map((category) => labels[category]).join(', ')}? This
          cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Confirm deletion'}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={buttonClass}>
            Cancel
          </button>
        </div>
      </div>
    )
  );
}

export function CleanupSelection({
  preview,
  previewError,
  days,
  setDays,
  setConfirming,
  setResult,
  setError,
  selected,
  setSelected,
  busy,
}: CleanupSelectionProps) {
  return (
    <CleanupOptions
      preview={preview}
      unavailable={Boolean(previewError)}
      days={days}
      onDays={(value) => {
        setDays(value);
        setConfirming(false);
        setResult('');
        setError('');
      }}
      selected={selected}
      onSelect={(value) => {
        setSelected(value);
        setConfirming(false);
      }}
      busy={busy}
      onDelete={() => setConfirming(true)}
    />
  );
}
