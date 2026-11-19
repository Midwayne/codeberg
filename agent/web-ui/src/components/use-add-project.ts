import { useState } from 'react';

import { requestAddProject } from '../lib/project-add-request';
import type { Project } from '../lib/project-api';
import { useRepositoryPreview } from '../lib/use-repository-preview';
import { useFolderPicker } from './use-folder-picker';

export type AddProjectProps = {
  initialPath?: string;
  onClose: () => void;
  onAdded: (project: Project) => Promise<void>;
  onExisting: (project: Project) => Promise<void>;
};

/** The chosen directory, and the project that already uses it, if any. */
function useDirectoryChoice() {
  const [root, setRootValue] = useState('');
  const [existing, setExisting] = useState<Project>();

  // Editing the path starts a new attempt, so an earlier match no longer applies.
  const setRoot = (value: string) => {
    setRootValue(value);
    setExisting(undefined);
  };

  return { root, setRoot, existing, setExisting };
}

export function useAddProject({ initialPath, onClose, onAdded, onExisting }: AddProjectProps) {
  const { root, setRoot, existing, setExisting } = useDirectoryChoice();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { choosing, directoryInput, chooseFolder } = useFolderPicker({
    busy,
    root,
    initialPath,
    setRoot,
    setError,
  });
  const { preview, ignored, toggleRepository, setIgnored } = useRepositoryPreview(root);

  async function add() {
    const result = await requestAddProject(name, root, ignored);

    if (result.kind === 'added') return onAdded(result.project);

    setExisting(result.project);
    await onExisting(result.project);
  }

  const submit = submitter({
    ready: !choosing && !busy && Boolean(root.trim()),
    add,
    setBusy,
    setError,
  });

  return {
    onClose,
    choosing,
    busy,
    root,
    name,
    chooseFolder,
    directoryInput,
    setRoot,
    setName,
    error,
    existing,
    submit,
    preview,
    ignored,
    toggleRepository,
    setIgnored,
  };
}

type SubmitOptions = {
  ready: boolean;
  add: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
};

/** Form submit: one attempt at a time, with its failure shown in the dialog. */
function submitter({ ready, add, setBusy, setError }: SubmitOptions) {
  return (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError('');

    void add()
      .catch((reason: unknown) => setError(String(reason)))
      .finally(() => setBusy(false));
  };
}
