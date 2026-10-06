import { labels, descriptions, buttonClass } from './settings-styles';

import { formatBytes, type CleanupCategory, type CleanupPreview } from '../lib/resources';
import { Select } from './ui';

export type CleanupOptionsProps = {
  preview?: CleanupPreview;
  selected: CleanupCategory[];
  onSelect: (value: CleanupCategory[]) => void;
  unavailable?: boolean;
  days: number;
  onDays: (value: number) => void;
  busy: boolean;
  onDelete: () => void;
};

export function CleanupOptions({
  preview,
  unavailable,
  selected,
  onSelect,
  days,
  onDays,
  busy,
  onDelete,
}: CleanupOptionsProps) {
  const rows = preview?.categories;
  const matches = rows?.filter((row) => selected.includes(row.category)) ?? [];
  const count = matches.reduce((sum, row) => sum + row.count, 0);
  const bytes = matches.reduce((sum, row) => sum + row.bytes, 0);
  return (
    <div className="space-y-4">
      <CleanupAge days={days} busy={busy} onDays={onDays} />
      <CleanupCategories
        busy={busy}
        preview={preview}
        rows={rows}
        selected={selected}
        onSelect={onSelect}
        unavailable={unavailable}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {count} files selected · {formatBytes(bytes)} reclaimable
        </p>
        <button
          type="button"
          disabled={busy || !preview || !count}
          onClick={onDelete}
          className={`${buttonClass} text-destructive`}
        >
          Delete selected data…
        </button>
      </div>
    </div>
  );
}

export type CleanupCategoriesProps = Pick<
  Parameters<typeof CleanupOptions>[0],
  'busy' | 'preview' | 'selected' | 'onSelect' | 'unavailable'
> & { rows: { category: CleanupCategory; count: number; bytes: number }[] | undefined };

export function CleanupCategories({ busy, preview, rows, selected, onSelect, unavailable }: CleanupCategoriesProps) {
  return (
    <fieldset disabled={busy || !preview} className="space-y-3">
      <legend className="sr-only">Data to delete</legend>
      {(['chats', 'training', 'knowledge'] as const).map((category) => {
        const row = rows?.find((item) => item.category === category);
        return (
          <label key={category} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
            <input
              type="checkbox"
              checked={selected.includes(category)}
              onChange={(event) =>
                onSelect(
                  event.currentTarget.checked ? [...selected, category] : selected.filter((item) => item !== category),
                )
              }
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <span className="min-w-0 flex-1">
              <span className="text-sm font-medium">{labels[category]}</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{descriptions[category]}</span>
            </span>
            <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {row ? (
                <>
                  {row.count} files
                  <br />
                  {formatBytes(row.bytes)}
                </>
              ) : unavailable ? (
                'Unavailable'
              ) : (
                'Calculating…'
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export type CleanupAgeProps = Pick<Parameters<typeof CleanupOptions>[0], 'days' | 'busy' | 'onDays'>;

export function CleanupAge({ days, busy, onDays }: CleanupAgeProps) {
  return (
    <label className="block text-sm font-medium">
      Older than{' '}
      <Select
        value={days}
        disabled={busy}
        onChange={(event) => onDays(Number(event.currentTarget.value))}
        wrapperClassName="ml-2"
      >
        {[7, 30, 90, 365].map((value) => (
          <option key={value} value={value}>
            {value} days
          </option>
        ))}
        <option value={0}>All ages</option>
      </Select>
    </label>
  );
}
