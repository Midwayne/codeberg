import { useFolderPicker } from './use-folder-picker';

import { control, button } from './project-styles';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Dialog, IconButton } from './ui';
import type { Project } from '../lib/project-api';
import type { AddProjectViewProps } from './projects';
import { ProjectDirectoryField } from './project-directory';
import { readJson, jsonInit } from '../lib/http';

type AddProjectProps = {
  initialPath?: string;
  onClose: () => void;
  onAdded: (project: Project) => Promise<void>;
};

export function AddProject(props: AddProjectProps) {
  const state = useAddProject(props);

  return <AddProjectView {...state} />;
}

export function useAddProject({ initialPath, onClose, onAdded }: AddProjectProps) {
  const [root, setRoot] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { choosing, directoryInput, chooseFolder } = useFolderPicker({ busy, root, initialPath, setRoot, setError });

  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (choosing || busy || !root.trim()) return;

    setBusy(true);
    setError('');

    void fetch('/api/projects', jsonInit('POST', { name, root }))
      .then(async (response) => onAdded(await readJson<Project>(response)))
      .catch((reason: unknown) => setError(String(reason)))
      .finally(() => setBusy(false));
  }

  return { onClose, choosing, busy, root, name, chooseFolder, directoryInput, setRoot, setName, error, submit };
}

export function AddProjectView(state: AddProjectViewProps) {
  return (
    <Dialog label="Add project" onClose={state.onClose} className="m-auto w-[calc(100vw-2rem)] max-w-xl">
      <form
        className="space-y-5 p-5 sm:p-6"
        onSubmit={state.submit}
      >
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
        <OptionalProjectName state={state} />
        {state.error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {state.error}
          </p>
        )}
        <AddProjectActions onClose={state.onClose} busy={state.busy} choosing={state.choosing} root={state.root} />
      </form>
    </Dialog>
  );
}

type AddProjectActionsProps = Pick<
  Parameters<typeof AddProjectView>[0],
  'onClose' | 'busy' | 'choosing' | 'root'
>;

function AddProjectActions({ onClose, busy, choosing, root }: AddProjectActionsProps) {
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
