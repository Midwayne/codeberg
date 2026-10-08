export type ProjectDeletionMode = 'index' | 'all';

export type ProjectDeleteOptionsProps = {
  mode: ProjectDeletionMode;
  onChange: (mode: ProjectDeletionMode) => void;
  disabled: boolean;
};

export function ProjectDeleteOptions({ mode, onChange, disabled }: ProjectDeleteOptionsProps) {
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <legend className="mb-3 text-sm font-medium">Choose what to delete</legend>
      <DeletionOption value="index" mode={mode} onChange={onChange} title="Delete indexed files only">
        Keep chats, history and knowledge. Knowledge will be reused if you add this repository again.
      </DeletionOption>
      <DeletionOption value="all" mode={mode} onChange={onChange} title="Delete entire history, including knowledge">
        Permanently delete indexed files, chats, knowledge, learning data and project configuration. This cannot be undone.
      </DeletionOption>
      <p className="text-xs leading-5 text-muted-foreground">Your repository and source files stay on disk.</p>
    </fieldset>
  );
}

type DeletionOptionProps = Pick<ProjectDeleteOptionsProps, 'mode' | 'onChange'> & {
  value: ProjectDeletionMode;
  title: string;
  children: string;
};

function DeletionOption({ value, mode, onChange, title, children }: DeletionOptionProps) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-ring">
      <input
        type="radio"
        name="project-deletion-mode"
        value={value}
        checked={mode === value}
        onChange={() => onChange(value)}
        className="mt-1 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
      />
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs leading-5 text-muted-foreground">{children}</span>
      </span>
    </label>
  );
}
