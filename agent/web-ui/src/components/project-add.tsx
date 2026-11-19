import { control, button } from './project-styles';
import { X } from 'lucide-react';
import { Dialog, IconButton } from './ui';
import type { Project } from '../lib/project-api';
import type { AddProjectViewProps } from './projects';
import { ProjectDirectoryField } from './project-directory';
import { useAddProject, type AddProjectProps } from './use-add-project';
import { AddProjectRepositories } from './project-add-repositories';

export { useAddProject } from './use-add-project';

export function AddProject(props: AddProjectProps) {
  const state = useAddProject(props);

  return <AddProjectView {...state} />;
}

export function AddProjectView(state: AddProjectViewProps) {
  return (
    <Dialog
      label="Add project"
      onClose={state.onClose}
      className="m-auto w-[calc(100vw-2rem)] max-w-xl"
    >
      <form className="space-y-5 p-5 sm:p-6" onSubmit={state.submit}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Add project</h2>
          <IconButton aria-label="Close add project" onClick={state.onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Chats, knowledge and training data stay with this project.
        </p>
        <ProjectDirectoryField
          choosing={state.choosing}
          busy={state.busy}
          chooseFolder={state.chooseFolder}
          directoryInput={state.directoryInput}
          root={state.root}
          setRoot={state.setRoot}
        />
        <AddProjectRepositories
          preview={state.preview}
          ignored={state.ignored}
          busy={state.busy}
          onToggle={state.toggleRepository}
        />
        <OptionalProjectName state={state} />
        {state.error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {state.error}
          </p>
        )}
        {state.existing && <ExistingProjectNotice project={state.existing} />}
        <AddProjectActions state={state} />
      </form>
    </Dialog>
  );
}

function ExistingProjectNotice({ project }: { project: Project }) {
  return (
    <p role="status" className="break-words rounded-lg bg-muted p-3 text-sm leading-6">
      This directory already belongs to <strong>{project.name}</strong>, so Codeberg switched to it.
    </p>
  );
}

function AddProjectActions({ state }: { state: Parameters<typeof AddProjectView>[0] }) {
  const { onClose, busy, choosing, root, existing } = state;

  if (existing) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-end gap-2">
      <button type="button" className={button} onClick={onClose}>
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy || choosing || !root.trim()}
        className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
      >
        {busy ? 'Adding…' : 'Add project'}
      </button>
    </div>
  );
}

type OptionalProjectNameProps = { state: Parameters<typeof AddProjectView>[0] };

function OptionalProjectName({ state }: OptionalProjectNameProps) {
  return (
    <label className="block space-y-2 text-sm">
      <span>
        Project name <span className="text-muted-foreground">(optional)</span>
      </span>
      <input
        value={state.name}
        maxLength={120}
        onChange={(event) => state.setName(event.target.value)}
        className={control}
      />
    </label>
  );
}
