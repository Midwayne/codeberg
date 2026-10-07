import { type ProjectCatalog } from '../lib/project-api';
import { type ProjectShellView } from './projects';
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
          if (!response.ok) throw new Error(await response.text());

          setCatalog((await response.json()) as ProjectCatalog);
          select(project.id);
          setAdding(false);
        }}
      />
    </MotionPresence>
  );
}
