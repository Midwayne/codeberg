import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { starterPage, type ChatStarter } from './chat-starters';

type ChatEmptyStateProps = { onChoose: (question: string) => void };

export function ChatEmptyState({ onChoose }: ChatEmptyStateProps) {
  const [page, setPage] = useState(0);

  return (
    <div className="mx-auto w-full max-w-2xl py-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">What do you want to know?</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick a starting point to edit, or ask anything about this project.
      </p>

      <div className="mt-8 grid gap-2 sm:grid-cols-2">
        {starterPage(page).map((starter) => (
          <StarterCard key={starter.title} starter={starter} onChoose={onChoose} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">
          Tip: type <span className="font-mono text-foreground">/enhance</span> to turn a rough request into an
          agent-ready brief.
        </p>
        <button
          type="button"
          onClick={() => setPage((current) => current + 1)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <RefreshCw aria-hidden="true" className="size-3.5" />
          More ideas
        </button>
      </div>
    </div>
  );
}

type StarterCardProps = { starter: ChatStarter; onChoose: (question: string) => void };

function StarterCard({ starter, onChoose }: StarterCardProps) {
  const Icon = starter.icon;

  return (
    <button
      type="button"
      onClick={() => onChoose(starter.prompt)}
      className="group flex min-h-24 flex-col gap-1.5 rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-accent"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        {starter.title}
      </span>
      <span className="text-xs leading-5 text-muted-foreground">{starter.prompt}</span>
    </button>
  );
}
