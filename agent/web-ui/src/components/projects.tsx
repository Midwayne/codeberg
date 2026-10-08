import { useProjectDeletionFocus } from '../lib/use-project-deletion-focus';
import { type useAddProject } from './project-add';
import { AddProjectDialog } from './project-add-dialog';

import { ProjectDetails } from './project-details';
import { useProjectShell } from '../lib/use-project-shell';

import { type ReactNode } from 'react';

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
  const focusAfterDeletion = useProjectDeletionFocus();

  return (
    <ProjectApiContext.Provider
      key={state.project?.id ?? 'loading'}
      value={{
        project: state.project,
        fetch: state.api,
        ready: state.ready,
        onProjectDeleted: (catalog) => {
          state.setCatalog(catalog);
          focusAfterDeletion();
          if (!catalog.projects.some((project) => project.id === state.project?.id)) state.select(catalog.defaultId);
        },
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

function NoProjects({ onAdd }: { onAdd: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">Add a project to get started</h1>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">Choose a repository to index and explore.</p>
      <button
        type="button"
        data-add-project
        onClick={onAdd}
        className="min-h-11 rounded-lg bg-primary px-4 text-sm text-primary-foreground"
      >
        Add project
      </button>
    </main>
  );
}
