import { ProjectDetails } from './project-details';

import { useEffect, useState } from 'react';
import { CopyButton, ErrorNotice } from './ui';
import { useProjectApi, type ProjectCatalog } from '../lib/project-api';
import { type ProjectListProps } from './projects';

export function ProjectsPanel() {
  const { project: selectedProject, onProjectRenamed } = useProjectApi();
  const [catalog, setCatalog] = useState<ProjectCatalog>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void fetch('/api/projects', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        const value = (await response.json()) as ProjectCatalog;
        if (!controller.signal.aborted) setCatalog(value);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <section className="space-y-6" aria-labelledby="projects-heading">
      <ProjectsHeading />
      {error && (
        <ErrorNotice title="Could not load projects" detail={error} onRetry={() => setRetry((value) => value + 1)} />
      )}
      {!catalog && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading projects…
        </p>
      )}
      {catalog?.projects.length === 0 && (
        <p className="text-sm leading-6 text-muted-foreground">
          No projects yet. Use Add project in the chat sidebar to choose a repository.
        </p>
      )}
      <ProjectList
        catalog={catalog}
        selectedProject={selectedProject}
        setCatalog={setCatalog}
        onProjectRenamed={onProjectRenamed}
      />
      <ProjectCatalogLocation catalog={catalog} />
    </section>
  );
}

export type ProjectCatalogLocationProps = { catalog: ProjectCatalog | undefined };

export function ProjectCatalogLocation({ catalog }: ProjectCatalogLocationProps) {
  return (
    catalog?.catalogPath && (
      <div className="space-y-2 border-t border-border pt-5">
        <p className="text-sm font-medium">Project catalog</p>
        <div className="flex min-w-0 items-start justify-between gap-3">
          <code className="min-w-0 break-all text-xs leading-6 text-muted-foreground select-all">
            {catalog.catalogPath}
          </code>
          <CopyButton text={catalog.catalogPath} label="Copy project catalog path" />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Maps project names and directories to their IDs. Renaming keeps your chats and indexed data in place.
        </p>
      </div>
    )
  );
}

export function ProjectList({ catalog, selectedProject, setCatalog, onProjectRenamed }: ProjectListProps) {
  return (
    <div className="divide-y divide-border">
      {catalog?.projects.map((project) => (
        <ProjectDetails
          key={project.id}
          project={project}
          current={project.id === selectedProject?.id}
          onRenamed={(updated) => {
            setCatalog(
              (current) =>
                current && {
                  ...current,
                  projects: current.projects.map((project) => (project.id === updated.id ? updated : project)),
                },
            );
            onProjectRenamed?.(updated);
          }}
        />
      ))}
    </div>
  );
}

function ProjectsHeading() {
  return (
    <div className="space-y-2">
      <h2 id="projects-heading" className="text-lg font-semibold">
        Projects
      </h2>
      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        Manage project names and find their config files.
      </p>
    </div>
  );
}
