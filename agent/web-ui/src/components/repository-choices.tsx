import { useState } from 'react';

import { button } from './project-styles';

export type RepositoryChoice = { path: string; key: string; detail: string };

/** Longer lists get a filter and check-all controls. */
const BULK_THRESHOLD = 8;

type RepositoryChoicesProps = {
  choices: RepositoryChoice[];
  ignored: string[];
  disabled?: boolean;
  onToggle: (path: string) => void;
  onSetIgnored?: (ignored: string[]) => void;
};

/** Checked folders are indexed as their own repository; unchecked stay in the project directory. */
export function RepositoryChoices({
  choices,
  ignored,
  disabled = false,
  onToggle,
  onSetIgnored,
}: RepositoryChoicesProps) {
  const [filter, setFilter] = useState('');

  if (choices.length === 0) return null;

  const shown = matchingChoices(choices, filter);
  const bulk = onSetIgnored && choices.length > BULK_THRESHOLD;

  return (
    <div className="space-y-2">
      {bulk && (
        <ChoiceToolbar
          filter={filter}
          disabled={disabled}
          setFilter={setFilter}
          setChecked={(checked) => onSetIgnored(bulkIgnored(ignored, shown, checked))}
        />
      )}
      <ChoiceList choices={shown} ignored={ignored} disabled={disabled} onToggle={onToggle} />
    </div>
  );
}

type ChoiceToolbarProps = {
  filter: string;
  disabled: boolean;
  setFilter: (filter: string) => void;
  setChecked: (checked: boolean) => void;
};

function ChoiceToolbar({ filter, disabled, setFilter, setChecked }: ChoiceToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        aria-label="Filter repositories"
        placeholder="Filter folders"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="min-h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
      />
      <button type="button" className={button} disabled={disabled} onClick={() => setChecked(true)}>
        Check all
      </button>
      <button
        type="button"
        className={button}
        disabled={disabled}
        onClick={() => setChecked(false)}
      >
        Uncheck all
      </button>
    </div>
  );
}

type ChoiceListProps = Omit<RepositoryChoicesProps, 'onSetIgnored'>;

function ChoiceList({ choices, ignored, disabled, onToggle }: ChoiceListProps) {
  if (choices.length === 0)
    return <p className="px-1 text-sm text-muted-foreground">No folders match.</p>;

  return (
    <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
      {choices.map((choice) => (
        <li key={choice.path}>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-current"
              checked={!ignored.includes(choice.path)}
              disabled={disabled}
              onChange={() => onToggle(choice.path)}
            />
            <span className="min-w-0 flex-1">
              <span className="block break-all font-medium">{choice.path}</span>
              <span className="block text-xs text-muted-foreground">{choice.detail}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Choices whose folder path contains `filter`, ignoring case. */
export function matchingChoices(choices: RepositoryChoice[], filter: string): RepositoryChoice[] {
  const needle = filter.trim().toLowerCase();

  return needle ? choices.filter((choice) => choice.path.toLowerCase().includes(needle)) : choices;
}

/** Checks or unchecks every shown choice, leaving the rest as they were. */
export function bulkIgnored(
  ignored: string[],
  shown: RepositoryChoice[],
  checked: boolean,
): string[] {
  const paths = new Set(shown.map((choice) => choice.path));
  const rest = ignored.filter((path) => !paths.has(path));

  return checked ? rest : [...rest, ...paths];
}

export function repositorySummary(total: number, ignoredCount: number): string {
  const found = total === 1 ? '1 repository found' : `${total} repositories found`;
  const separate = total - ignoredCount;

  if (separate === total) return `${found} · ${total === 1 ? 'indexed' : 'all indexed'} separately`;
  if (separate === 0) return `${found} · none indexed separately`;

  return `${found} · ${separate} of ${total} indexed separately`;
}

/** Adds or removes `path` from an ignored list. */
export function toggled(ignored: string[], path: string): string[] {
  return ignored.includes(path) ? ignored.filter((item) => item !== path) : [...ignored, path];
}
