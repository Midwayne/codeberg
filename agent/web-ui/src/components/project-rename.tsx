import { control, button } from './project-styles';

import { useEffect, useRef, useState } from 'react';

import { type Project } from '../lib/project-api';

export type RenameProjectFormProps = {
  project: Project;
  onRenamed: (project: Project) => void;
  onCancel: () => void;
};

export function RenameProjectForm(props: RenameProjectFormProps) {
  const state = useRenameProject(props);

  return <RenameProjectFormView {...state} />;
}

export type RenameProjectOptions = {
  project: Project;
  onRenamed: (project: Project) => void;
  onCancel: () => void;
};

export function useRenameProject({ project, onRenamed, onCancel }: RenameProjectOptions) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return { busy, onCancel, name, project, setBusy, setError, onRenamed, input, setName, error };
}

export type RenameProjectFormViewProps = ReturnType<typeof useRenameProject>;

export function RenameProjectFormView({
  busy,
  onCancel,
  name,
  project,
  setBusy,
  setError,
  onRenamed,
  input,
  setName,
  error,
}: RenameProjectFormViewProps) {
  return (
    <form
      className="space-y-3 rounded-lg bg-muted/40 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      onSubmit={createProjectRenameSubmit({ busy, name, project, setBusy, setError, onRenamed })}
    >
      <ProjectNameField project={project} />
      <RenameProjectInput
        input={input}
        project={project}
        name={name}
        busy={busy}
        setName={setName}
        setError={setError}
      />
      <RenameProjectActions busy={busy} onCancel={onCancel} name={name} project={project} />
      {error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

export type ProjectNameFieldProps = Pick<Parameters<typeof RenameProjectFormView>[0], 'project'>;

export function ProjectNameField({ project }: ProjectNameFieldProps) {
  return (
    <label htmlFor={`project-name-${project.id}`} className="block text-sm font-medium">
      Project name
    </label>
  );
}

export type RenameProjectActionsProps = Pick<
  Parameters<typeof RenameProjectFormView>[0],
  'busy' | 'onCancel' | 'name' | 'project'
>;

export function RenameProjectActions({ busy, onCancel, name, project }: RenameProjectActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className={`${button} focus-visible:outline-2 focus-visible:outline-ring`}
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy || !name.trim() || name.trim() === project.name}
        className="min-h-11 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save name'}
      </button>
    </div>
  );
}

export type RenameProjectInputProps = Pick<
  Parameters<typeof RenameProjectFormView>[0],
  'input' | 'project' | 'name' | 'busy' | 'setName' | 'setError'
>;

export function RenameProjectInput({ input, project, name, busy, setName, setError }: RenameProjectInputProps) {
  return (
    <input
      ref={input}
      id={`project-name-${project.id}`}
      required
      maxLength={120}
      value={name}
      disabled={busy}
      onChange={(event) => {
        setName(event.target.value);
        setError('');
      }}
      className={control}
    />
  );
}

export type ProjectRenameSubmitOptions = Pick<
  Parameters<typeof RenameProjectFormView>[0],
  'busy' | 'name' | 'project' | 'setBusy' | 'setError' | 'onRenamed'
>;

function createProjectRenameSubmit({ busy, name, project, setBusy, setError, onRenamed }: ProjectRenameSubmitOptions) {
  return (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !name.trim() || name.trim() === project.name) return;
    setBusy(true);
    setError('');
    void fetch(`/api/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
      .then(async (response) => {
        const text = await response.text();
        let result: Project & { message?: string };
        try {
          result = JSON.parse(text) as typeof result;
        } catch {
          throw new Error(text || 'Could not save the project name. Try again.');
        }
        if (!response.ok) throw new Error(result.message || 'Could not save the project name. Try again.');
        onRenamed(result);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
}
