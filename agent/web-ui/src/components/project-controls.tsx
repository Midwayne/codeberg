import { button } from './project-styles';
import { FolderPlus } from 'lucide-react';

import { IconButton, Select } from './ui';
import { type Project, type ProjectCatalog, type ProjectStatus } from '../lib/project-api';

export type ProjectToolbarProps = {
  project: Project | undefined;
  selected: string;
  catalog: ProjectCatalog | undefined;
  select: (id: string) => void;
  setAdding: React.Dispatch<React.SetStateAction<boolean>>;
};

export function ProjectToolbar({ project, selected, catalog, select, setAdding }: ProjectToolbarProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Select
        aria-label="Project"
        title={project?.roots.map((root) => root.root).join('\n')}
        value={selected}
        disabled={!catalog}
        onChange={(event) => select(event.target.value)}
        className="font-semibold sm:text-base"
      >
        {!catalog && <option value="">Loading projects…</option>}
        {catalog?.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </Select>
      <IconButton
        aria-label="Add project"
        title="Add project"
        disabled={!catalog}
        onClick={() => setAdding(true)}
        className="size-11 sm:size-11"
      >
        <FolderPlus className="size-4" />
      </IconButton>
    </div>
  );
}

export type ProjectNoticeProps = {
  currentStatus: { id: string; value?: ProjectStatus; error?: string } | undefined;
  project: Project;
  api: typeof fetch;
  setRetry: React.Dispatch<React.SetStateAction<number>>;
  setStatus: React.Dispatch<React.SetStateAction<{ id: string; value?: ProjectStatus; error?: string } | undefined>>;
};

export function ProjectNotice({ currentStatus, project, api, setRetry, setStatus }: ProjectNoticeProps) {
  return (
    <div
      role={currentStatus?.error ? 'alert' : 'status'}
      className="flex shrink-0 items-start gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground mx-3 my-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {currentStatus?.error ? 'Project index unavailable' : `Indexing ${project.name}…`}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {currentStatus?.error ??
            `${currentStatus?.value?.chunks ?? 0} chunks indexed. You can read chats and draft a question while Codeberg prepares search.`}
        </p>
      </div>
      {currentStatus?.error && (
        <button
          type="button"
          className={button}
          onClick={() => {
            void api('/api/project/retry', { method: 'POST' })
              .then((response) => {
                if (!response.ok) throw new Error('Retry failed');
                setRetry((value) => value + 1);
              })
              .catch((reason: unknown) => setStatus({ id: project.id, error: String(reason) }));
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
