import { requestProjectCatalog } from '../lib/project-catalog-request';
import type { ProjectShellView } from './projects';
import { AddProject } from './project-add';
import { MotionPresence } from './motion-presence';

type AddProjectDialogProps = Pick<
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
          setCatalog(await requestProjectCatalog());
          select(project.id);
          setAdding(false);
        }}
      />
    </MotionPresence>
  );
}
