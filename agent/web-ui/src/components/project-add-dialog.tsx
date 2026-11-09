import type { ProjectCatalogInfo } from '@agent/core/api/projects.js';
import { responseJson } from '../lib/response.js';
import type { ProjectShellView } from './projects';
import { AddProject } from './project-add';
import { MotionPresence } from './motion-presence';

export type AddProjectDialogProps = Pick<
  Parameters<typeof ProjectShellView>[0],
  'adding' | 'project' | 'setAdding' | 'setCatalog' | 'select'
>;

export function AddProjectDialog({ adding, project, setAdding, setCatalog, select }: AddProjectDialogProps) {
  return (
    <MotionPresence visible={adding}>
      <AddProject
        initialPath={project?.roots[0]?.root}
        onClose={() => setAdding(false)}
        onAdded={async (project) => {
          const response = await fetch('/api/projects');
          setCatalog(await responseJson<ProjectCatalogInfo>(response));
          select(project.id);
          setAdding(false);
        }}
      />
    </MotionPresence>
  );
}
