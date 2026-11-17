import { control, button } from './project-styles';

import { useEffect, useRef, useState } from 'react';

import type { Project } from '../lib/project-api';
import { errorMessage } from '@agent/core/errors.js';
import { jsonInit, readJson } from '../lib/http';

type RenameProjectFormProps = {
  project: Project;
  onRenamed: (project: Project) => void;
  onCancel: () => void;
};

export function RenameProjectForm(props: RenameProjectFormProps) {
  const state = useRenameProject(props);

  return <RenameProjectFormView {...state} />;
}

const RENAME_FAILED = 'Could not save the project name. Try again.';

function useRenameProject({ project, onRenamed, onCancel }: RenameProjectFormProps) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim() || name.trim() === project.name) return;

    setBusy(true);
    setError('');

    void renameProject(project.id, name.trim())
      .then(onRenamed)
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(false));
  }

  return { busy, onCancel, name, project, input, setName, setError, error, submit };
}

async function renameProject(id: string, name: string): Promise<Project> {
  const response = await fetch(`/api/projects/${id}`, jsonInit('PATCH', { name }));

  return readJson<Project>(response, RENAME_FAILED);
}

type RenameProjectFormViewProps = ReturnType<typeof useRenameProject>;

function RenameProjectFormView({
  busy,
  onCancel,
  name,
  project,
  input,
  setName,
  setError,
  error,
  submit,
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
      onSubmit={submit}
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

type ProjectNameFieldProps = Pick<Parameters<typeof RenameProjectFormView>[0], 'project'>;

function ProjectNameField({ project }: ProjectNameFieldProps) {
  return (
    <label htmlFor={`project-name-${project.id}`} className="block text-sm font-medium">
      Project name
    </label>
  );
}

type RenameProjectActionsProps = Pick<
  Parameters<typeof RenameProjectFormView>[0],
  'busy' | 'onCancel' | 'name' | 'project'
>;

function RenameProjectActions({ busy, onCancel, name, project }: RenameProjectActionsProps) {
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

type RenameProjectInputProps = Pick<
  Parameters<typeof RenameProjectFormView>[0],
  'input' | 'project' | 'name' | 'busy' | 'setName' | 'setError'
>;

function RenameProjectInput({ input, project, name, busy, setName, setError }: RenameProjectInputProps) {
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
