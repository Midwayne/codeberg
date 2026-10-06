import { type AddProjectView } from './project-add';

import { Folder } from 'lucide-react';

export type ProjectDirectoryFieldProps = Pick<
  Parameters<typeof AddProjectView>[0],
  'choosing' | 'busy' | 'chooseFolder' | 'directoryInput' | 'root' | 'setRoot'
>;

export function ProjectDirectoryField(state: ProjectDirectoryFieldProps) {
  return (
    <div className="space-y-2">
      <label htmlFor="project-directory" className="block text-sm">
        Directory path
      </label>
      <div
        role="group"
        aria-label="Project directory"
        className="flex min-w-0 items-stretch overflow-hidden rounded-xl border border-input bg-background focus-within:ring-2 focus-within:ring-ring"
      >
        <button
          type="button"
          aria-label="Choose folder"
          title="Choose folder"
          disabled={state.choosing || state.busy}
          onClick={() => void state.chooseFolder()}
          className="inline-flex min-h-12 w-12 shrink-0 items-center justify-center border-r border-input text-foreground transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
        >
          <Folder className="size-5" />
        </button>
        <input
          id="project-directory"
          ref={state.directoryInput}
          aria-describedby="project-directory-help"
          required
          value={state.root}
          disabled={state.choosing || state.busy}
          onChange={(event) => state.setRoot(event.target.value)}
          placeholder="/path/to/project"
          className="min-h-12 min-w-0 flex-1 bg-transparent px-4 py-3 text-base placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50 sm:text-sm"
        />
      </div>
      <p id="project-directory-help" className="text-xs text-muted-foreground">
        Use the folder button or enter the directory path manually.
      </p>
      {state.choosing && (
        <p role="status" className="text-sm text-muted-foreground">
          Select a folder in the system dialog, or cancel to return here.
        </p>
      )}
    </div>
  );
}
