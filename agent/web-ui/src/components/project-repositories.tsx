import { useState } from 'react';

import { errorMessage } from '@agent/core/errors.js';
import type { Project } from '../lib/project-api';
import { rescanRepositories } from '../lib/repository-requests';
import { button } from './project-styles';
import { RepositoryChoices, toggled, type RepositoryChoice } from './repository-choices';

type ProjectRepositoriesProps = { project: Project; onUpdated: (project: Project) => void };

/** The repositories inside a project directory, and the way to find them again. */
export function ProjectRepositories({ project, onUpdated }: ProjectRepositoriesProps) {
  const [ignored, setIgnored] = useState(project.ignored ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // A workspace started with several fixed roots has no directory to search.
  if (!project.directory && project.roots.length > 1) return null;

  function rescan(nextIgnored?: string[]) {
    setBusy(true);
    setMessage('');

    void rescanRepositories(project.id, nextIgnored)
      .then((updated) => {
        onUpdated(updated);
        setIgnored(updated.ignored ?? []);
        setMessage(rescanSummary(project, updated));
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)))
      .finally(() => setBusy(false));
  }

  return (
    <section aria-label={`Repositories in ${project.name}`} className="space-y-3 text-sm">
      <h4 className="font-medium">Repositories</h4>
      {project.discover ? (
        <DiscoveredRepositories
          project={project}
          ignored={ignored}
          busy={busy}
          setIgnored={setIgnored}
          rescan={rescan}
        />
      ) : (
        <FindRepositories busy={busy} rescan={() => rescan(undefined)} />
      )}
      {message && (
        <p role="status" className="break-words text-xs leading-5 text-muted-foreground">
          {message}
        </p>
      )}
    </section>
  );
}

type DiscoveredProps = {
  project: Project;
  ignored: string[];
  busy: boolean;
  setIgnored: (ignored: string[]) => void;
  rescan: (ignored?: string[]) => void;
};

function DiscoveredRepositories({ project, ignored, busy, setIgnored, rescan }: DiscoveredProps) {
  const choices = repositoryChoices(project);
  const changed = [...ignored].sort().join('\0') !== [...(project.ignored ?? [])].sort().join('\0');

  return (
    <>
      {choices.length === 0 ? (
        <p className="leading-6 text-muted-foreground">
          No separate repositories inside this directory.
        </p>
      ) : (
        <RepositoryChoices
          choices={choices}
          ignored={ignored}
          disabled={busy}
          onToggle={(path) => setIgnored(toggled(ignored, path))}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {changed && (
          <button type="button" className={button} disabled={busy} onClick={() => rescan(ignored)}>
            Save repositories
          </button>
        )}
        <button type="button" className={button} disabled={busy} onClick={() => rescan(undefined)}>
          {busy ? 'Scanning…' : 'Rescan repositories'}
        </button>
      </div>
    </>
  );
}

function FindRepositories({ busy, rescan }: { busy: boolean; rescan: () => void }) {
  return (
    <>
      <p className="leading-6 text-muted-foreground">
        Index each repository in this directory on its own so code can be traced between them.
        Codeberg re-indexes the repositories it finds; chats and knowledge stay with the project.
      </p>
      <button type="button" className={button} disabled={busy} onClick={rescan}>
        {busy ? 'Scanning…' : 'Find repositories'}
      </button>
    </>
  );
}

/** Current repositories (checked) and folders kept in the directory (unchecked). */
function repositoryChoices(project: Project): RepositoryChoice[] {
  const directory = project.directory ?? project.roots[0]?.root ?? '';

  const current = project.roots.slice(1).map((root) => ({
    path: root.root.startsWith(`${directory}/`) ? root.root.slice(directory.length + 1) : root.root,
    key: root.key,
    detail: `Repository key: ${root.key}`,
  }));

  const kept = (project.ignored ?? []).map((path) => ({
    path,
    key: '',
    detail: 'Kept in the project directory',
  }));

  return [...current, ...kept].sort((left, right) => left.path.localeCompare(right.path));
}

function rescanSummary(before: Project, after: Project): string {
  const count = after.roots.length - 1;
  const found = count === 1 ? '1 repository' : `${count} repositories`;
  const changed = JSON.stringify(before.roots) !== JSON.stringify(after.roots);

  return changed
    ? `Found ${found}. Codeberg is re-indexing the changes.`
    : `Found ${found}. Nothing changed.`;
}
