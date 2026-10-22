import { NoProjects } from './no-projects';
import { useProjectDeletionFocus } from '../lib/use-project-deletion-focus';
import { type useAddProject } from './project-add';
import { AddProjectDialog } from './project-add-dialog';

import { ProjectDetails } from './project-details';
import { useProjectShell } from '../lib/use-project-shell';

import { useContext, type ReactNode } from 'react';
import { ProjectChatsContext } from '../sessions/project-chats';

import { ErrorNotice } from './ui';
import { ProjectApiContext, type Project, type ProjectCatalog } from '../lib/project-api';

export type ProjectShellProps = {
  children: (toolbar: ReactNode, loading: boolean, notice: ReactNode) => ReactNode;
};

export function ProjectShell(props: ProjectShellProps) {
  const state = useProjectShell(props);

  return <ProjectShellView {...state} />;
}

export type ProjectShellViewProps = ReturnType<typeof useProjectShell>;

export function ProjectShellView(state: ProjectShellViewProps) {
  const onProjectDeleted = useProjectDeletion(state);

  return (
    <ProjectApiContext.Provider
      key={state.project?.id ?? 'loading'}
      value={{
        project: state.project,
        fetch: state.api,
        ready: state.ready,
        onProjectDeleted,
        onProjectRenamed: (updated) => {
          state.setCatalog(
            (current) =>
              current && {
                ...current,
                projects: current.projects.map((project) => (project.id === updated.id ? updated : project)),
              },
          );
        },
      }}
    >
      {state.catalog?.projects.length === 0 ? (
        <NoProjects onAdd={() => state.setAdding(true)} />
      ) : state.children(state.toolbar, !state.project, state.notice)}
      {state.error && (
        <div className="fixed inset-x-4 bottom-4 z-40">
          <ErrorNotice
            title="Could not load projects"
            detail={state.error}
            onRetry={() => state.setRetry((value) => value + 1)}
          />
        </div>
      )}

      <AddProjectDialog
        adding={state.adding}
        project={state.project}
        setAdding={state.setAdding}
        setCatalog={state.setCatalog}
        select={state.select}
      />
    </ProjectApiContext.Provider>
  );
}

export type AddProjectViewProps = ReturnType<typeof useAddProject>;

export type ProjectListProps = {
  catalog: ProjectCatalog | undefined;
  selectedProject: Project | undefined;
  setCatalog: React.Dispatch<React.SetStateAction<ProjectCatalog | undefined>>;
  onProjectDeleted: ((catalog: ProjectCatalog) => void) | undefined;
  onProjectRenamed: ((project: Project) => void) | undefined;
};

export type ProjectRenameProps = Pick<Parameters<typeof ProjectDetails>[0], 'project' | 'onRenamed'> & {
  editing: boolean;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setSaved: React.Dispatch<React.SetStateAction<boolean>>;
};

export { ProjectsPanel } from './project-list';

export { ProjectDetails } from './project-details';

export { RenameProjectForm } from './project-rename';

export { AddProject } from './project-add';

function useProjectDeletion(state: ProjectShellViewProps) {
  const focusAfterDeletion = useProjectDeletionFocus();
  const chats = useContext(ProjectChatsContext);

  return (catalog: ProjectCatalog) => {
    chats?.retain(catalog.projects.map((project) => project.id));
    state.setCatalog(catalog);
    focusAfterDeletion();
    if (!catalog.projects.some((project) => project.id === state.project?.id)) state.select(catalog.defaultId);
  };
}
