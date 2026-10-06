import { useId, type ReactNode } from 'react';

export type ComponentsProps = { label: string; disabled: boolean; children: ReactNode };

export function Components({ label, disabled, children }: ComponentsProps) {
  return (
    <details className="mt-2 border-t border-border">
      <summary
        className={`min-h-11 cursor-pointer py-3 text-sm ${disabled ? 'text-muted-foreground' : 'text-foreground'}`}
      >
        {label}
      </summary>
      <div className="grid gap-x-6 sm:grid-cols-2">{children}</div>
    </details>
  );
}

export type ToggleProps = {
  label: string;
  description?: string;
  impact?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  small?: boolean;
};

export function Toggle({ label, description, impact, checked, disabled, onChange, small = false }: ToggleProps) {
  const id = useId();
  return (
    <label className="flex min-h-11 cursor-pointer items-start justify-between gap-4 py-3 has-disabled:cursor-default">
      <span className="min-w-0">
        <span className={`block text-sm ${small ? '' : 'font-medium'}`}>{label}</span>
        {description && (
          <span id={id} className="mt-1 block max-w-prose text-sm leading-6 text-muted-foreground">
            {description}
          </span>
        )}
        {impact && <span className="mt-2 block text-xs font-medium text-muted-foreground">{impact}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-checked={checked}
        aria-describedby={description ? id : undefined}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50"
      />
    </label>
  );
}
