import type { ProjectCatalogInfo, ProjectInfo } from '@agent/core/api/projects.js';
import { FolderPlus } from 'lucide-react';

import { IconButton, Select } from './ui';

export type ProjectToolbarProps = {
  project: ProjectInfo | undefined;
  selected: string;
  catalog: ProjectCatalogInfo | undefined;
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
