import { Pencil } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CopyButton } from './ui';
import { type Project } from '../lib/project-api';
import { type ProjectRenameProps } from './projects';
import { ProjectConfigFiles } from './project-config-files';
import { ProjectDelete } from './project-delete';
import { RenameProjectForm } from './project-rename';

export type ProjectDetailsProps = {
  project: Project;
  current?: boolean;
  onRenamed: (project: Project) => void;
  onDeleted?: (catalog: import('../lib/project-api').ProjectCatalog) => void;
};

export function ProjectDetails(state: ProjectDetailsProps) {
  const { current = false } = state;

  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!editing && wasEditing.current) renameButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  return (
    <article className="min-w-0 space-y-4 py-6 first:pt-0" aria-label={state.project.name}>
      <ProjectHeading
        project={state.project}
        current={current}
        saved={saved}
        editing={editing}
        renameButton={renameButton}
        setEditing={setEditing}
        setSaved={setSaved}
      />
      <ProjectRename
        editing={editing}
        project={state.project}
        setEditing={setEditing}
        onRenamed={state.onRenamed}
        setSaved={setSaved}
      />
      <ProjectLocations project={state.project} />
      <ProjectConfigFiles state={state} />
      {state.onDeleted && <ProjectDelete project={state.project} onDeleted={state.onDeleted} />}
    </article>
  );
}

export type ProjectLocationProps = {
  label: string;
  value: string;
  copyLabel: string;
  children?: ReactNode;
};

export function ProjectLocation({ label, value, copyLabel, children }: ProjectLocationProps) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
      <dt className="col-span-2 text-xs leading-6 text-muted-foreground sm:col-span-1">{label}</dt>
      <dd className="min-w-0 space-y-0.5 leading-6">
        {children}
        <code className="block break-all text-xs leading-6 text-muted-foreground select-all">{value}</code>
      </dd>
      <dd>
        <CopyButton text={value} label={copyLabel} />
      </dd>
    </div>
  );
}

export type ProjectLocationsProps = Pick<Parameters<typeof ProjectDetails>[0], 'project'>;

export function ProjectLocations({ project }: ProjectLocationsProps) {
  return (
    <dl className="space-y-3 text-sm">
      {project.roots.map((root) => (
        <ProjectLocation
          key={root.key}
          label="Directory"
          value={root.root}
          copyLabel={`Copy directory path for ${root.key}`}
        >
          <span className="block break-words font-medium">
            {root.root.split(/[\\/]/).filter(Boolean).at(-1) || root.root}
          </span>
        </ProjectLocation>
      ))}
      <ProjectLocation label="Project ID" value={project.id} copyLabel={`Copy project ID for ${project.name}`} />
      {project.configDirectory && (
        <ProjectLocation
          label="Config directory"
          value={project.configDirectory}
          copyLabel={`Copy config directory for ${project.name}`}
        />
      )}
    </dl>
  );
}

export type ProjectHeadingProps = Pick<Parameters<typeof ProjectDetails>[0], 'project' | 'current'> & {
  saved: boolean;
  editing: boolean;
  renameButton: React.RefObject<HTMLButtonElement | null>;
  setEditing: React.Dispatch<React.SetStateAction<boolean>>;
  setSaved: React.Dispatch<React.SetStateAction<boolean>>;
};

export function ProjectHeading({
  project,
  current,
  saved,
  editing,
  renameButton,
  setEditing,
  setSaved,
}: ProjectHeadingProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="min-w-0 max-w-full break-words text-base font-semibold">{project.name}</h3>
          {current && (
            <span className="rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground">Current project</span>
          )}
        </div>
        {saved && (
          <p role="status" className="text-xs text-muted-foreground">
            Project name saved.
          </p>
        )}
      </div>
      {!editing && (
        <button
          ref={renameButton}
          type="button"
          aria-label={`Rename ${project.name}`}
          onClick={() => {
            setEditing(true);
            setSaved(false);
          }}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Pencil aria-hidden="true" className="size-3.5" />
          Rename
        </button>
      )}
    </div>
  );
}

export function ProjectRename({ editing, project, setEditing, onRenamed, setSaved }: ProjectRenameProps) {
  return (
    editing && (
      <RenameProjectForm
        project={project}
        onCancel={() => setEditing(false)}
        onRenamed={(updated) => {
          onRenamed(updated);
          setEditing(false);
          setSaved(true);
        }}
      />
    )
  );
}
