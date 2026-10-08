import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Project, ProjectCatalog } from '../lib/project-api';
import { button } from './project-styles';
import { Dialog } from './ui';
import { ProjectDeleteOptions, type ProjectDeletionMode } from './project-delete-options';

export type ProjectDeleteProps = {
  project: Project;
  onDeleted: (catalog: ProjectCatalog) => void;
};

export function ProjectDelete({ project, onDeleted }: ProjectDeleteProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={trigger} type="button" className={`${button} inline-flex items-center gap-2 text-destructive`}
        aria-label={`Delete ${project.name}`} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" className="size-3.5" />
        Delete project
      </button>
      {open && <ProjectDeleteDialog project={project} onDeleted={onDeleted} onClose={() => {
        setOpen(false);
        trigger.current?.focus();
      }} />}
    </>
  );
}

type ProjectDeleteDialogProps = ProjectDeleteProps & { onClose: () => void };

export function ProjectDeleteDialog({ project, onDeleted, onClose }: ProjectDeleteDialogProps) {
  const state = useProjectDeletion(project, onDeleted);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);

  return (
    <Dialog preventClose={state.busy} label={`Delete ${project.name}`} onClose={() => { if (!state.busy) onClose(); }} className="m-auto w-lg">
      <form onSubmit={(event) => {
        event.preventDefault();
        void state.remove();
      }} className="min-w-0 space-y-5 p-6">
        <div className="space-y-2">
          <h2 className="break-words text-lg font-semibold">Delete {project.name}?</h2>
          <p className="text-sm leading-6 text-muted-foreground">The project will be removed from your project list.</p>
        </div>
        <ProjectDeleteOptions mode={state.mode} onChange={state.setMode} disabled={state.busy} />
        {state.error && <p role="alert" className="break-words text-sm text-destructive">{state.error}</p>}
        {state.busy && <p role="status" className="text-sm text-muted-foreground">Deleting project…</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button ref={cancel} type="button" disabled={state.busy} onClick={onClose} className={button}>Cancel</button>
          <button type="submit" disabled={state.busy}
            className="min-h-11 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring">
            {state.busy ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function useProjectDeletion(project: Project, onDeleted: ProjectDeleteProps['onDeleted']) {
  const [mode, setMode] = useState<ProjectDeletionMode>('index');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (busy) return;

    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? 'Could not delete project. Try again.');

      onDeleted(result as ProjectCatalog);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return { mode, setMode, busy, error, remove };
}
