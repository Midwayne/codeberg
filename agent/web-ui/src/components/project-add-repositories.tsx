import { ChevronDown } from 'lucide-react';

import type { RepositoryPreview } from '../lib/repository-requests';
import { RepositoryChoices, repositorySummary } from './repository-choices';

type AddRepositoriesProps = {
  preview: RepositoryPreview | undefined;
  ignored: string[];
  busy: boolean;
  onToggle: (path: string) => void;
  onSetIgnored: (ignored: string[]) => void;
};

/**
 * What the new project will index. Every repository found is indexed on its own
 * by default, so the list stays folded behind a summary until someone wants to
 * change it.
 */
export function AddProjectRepositories({
  preview,
  ignored,
  busy,
  onToggle,
  onSetIgnored,
}: AddRepositoriesProps) {
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
    <details className="group rounded-lg border border-border">
      <ReviewSummary text={repositorySummary(choices.length, ignored.length)} />
      <div className="space-y-2 border-t border-border p-3">
        <p className="text-sm leading-6 text-muted-foreground">
          Checked folders are indexed as their own repository, so code can be traced between them.
          Unchecked folders stay part of the project directory. Everything is searchable either way.
        </p>
        <RepositoryChoices
          choices={choices}
          ignored={ignored}
          disabled={busy}
          onToggle={onToggle}
          onSetIgnored={onSetIgnored}
        />
      </div>
    </details>
  );
}

function ReviewSummary({ text }: { text: string }) {
  return (
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
      <span className="min-w-0 flex-1 font-medium">{text}</span>
      <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
        Review
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180"
        />
      </span>
    </summary>
  );
}
