import type { RepositoryPreview } from '../lib/repository-requests';
import { RepositoryChoices } from './repository-choices';

type AddRepositoriesProps = {
  preview: RepositoryPreview | undefined;
  ignored: string[];
  busy: boolean;
  onToggle: (path: string) => void;
};

/** What the new project will index: its directory, plus each checked repository on its own. */
export function AddProjectRepositories({ preview, ignored, busy, onToggle }: AddRepositoriesProps) {
  if (!preview) return null;

  if (preview.repositories.length === 0) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        No separate repositories inside. Codeberg indexes this directory as one.
      </p>
    );
  }

  const choices = preview.repositories.map((repository) => ({
    path: repository.path,
    key: repository.key,
    detail: repository.marker === '.git' ? 'Git repository' : `Has ${repository.marker}`,
  }));

  return (
    <section aria-labelledby="add-project-repositories" className="space-y-2">
      <h3 id="add-project-repositories" className="text-sm font-medium">
        Repositories found ({preview.repositories.length})
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">
        Checked folders are indexed as their own repository, so code can be traced between them. Unchecked folders
        stay part of the project directory. Everything is searchable either way.
      </p>
      <RepositoryChoices choices={choices} ignored={ignored} disabled={busy} onToggle={onToggle} />
    </section>
  );
}
