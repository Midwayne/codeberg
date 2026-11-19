export type RepositoryChoice = { path: string; key: string; detail: string };

type RepositoryChoicesProps = {
  choices: RepositoryChoice[];
  ignored: string[];
  disabled?: boolean;
  onToggle: (path: string) => void;
};

/** Checked folders are indexed as their own repository; unchecked stay in the project directory. */
export function RepositoryChoices({ choices, ignored, disabled = false, onToggle }: RepositoryChoicesProps) {
  if (choices.length === 0) return null;

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

/** Adds or removes `path` from an ignored list. */
export function toggled(ignored: string[], path: string): string[] {
  return ignored.includes(path) ? ignored.filter((item) => item !== path) : [...ignored, path];
}
