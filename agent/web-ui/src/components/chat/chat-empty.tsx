import { ArrowUpRight } from 'lucide-react';

const questions = [
  'Where is the main entry point?',
  'How is authentication handled?',
  'How does a request flow through the system?',
];

export function ChatEmptyState({ onChoose }: { onChoose: (question: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-xl py-8 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">Ask about the codebase</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Semantic code search with citations.</p>
      <p className="mt-8 text-sm text-muted-foreground">Choose a question and edit it before sending.</p>
      <div className="mt-3 divide-y divide-border border-y border-border">
        {questions.map((question) => (
          <button key={question} type="button" onClick={() => onChoose(question)}
            className="group flex min-h-14 w-full items-center justify-between gap-4 rounded-md px-2 py-3 text-left text-sm hover:bg-accent">
            <span>{question}</span>
            <ArrowUpRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
          </button>
        ))}
      </div>
      <p className="mt-6 text-xs leading-5 text-muted-foreground">
        Tip: type <span className="font-mono text-foreground">/enhance</span> to turn a rough request into an agent-ready brief.
      </p>
    </div>
  );
}
