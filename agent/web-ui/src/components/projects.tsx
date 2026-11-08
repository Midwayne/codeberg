import type { ProjectCatalogInfo, ProjectInfo } from '@agent/core/api/projects.js';
import { NoProjects } from './no-projects';
import { useProjectDeletionFocus } from '../lib/use-project-deletion-focus';
import type { useAddProject } from './project-add';
import { AddProjectDialog } from './project-add-dialog';

import { ProjectDetails } from './project-details';
import { useProjectShell } from '../lib/use-project-shell';

import { useContext, type ReactNode } from 'react';
import { ProjectChatsContext } from '../sessions/project-chats';

import { ErrorNotice } from './ui';
import { ProjectApiContext } from '../lib/project-api';

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
  catalog: ProjectCatalogInfo | undefined;
  selectedProject: ProjectInfo | undefined;
  setCatalog: React.Dispatch<React.SetStateAction<ProjectCatalogInfo | undefined>>;
  onProjectDeleted: ((catalog: ProjectCatalogInfo) => void) | undefined;
  onProjectRenamed: ((project: ProjectInfo) => void) | undefined;
};

export type ProjectRenameProps = Pick<Parameters<typeof ProjectDetails>[0], 'project' | 'onRenamed'> & {
  editing: boolean;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setSaved: React.Dispatch<React.SetStateAction<boolean>>;
};

function useProjectDeletion(state: ProjectShellViewProps) {
  const focusAfterDeletion = useProjectDeletionFocus();
  const chats = useContext(ProjectChatsContext);

  return (catalog: ProjectCatalogInfo) => {
    chats?.retain(catalog.projects.map((project) => project.id));
    state.setCatalog(catalog);
    focusAfterDeletion();
    if (!catalog.projects.some((project) => project.id === state.project?.id)) state.select(catalog.defaultId);
  };
}
