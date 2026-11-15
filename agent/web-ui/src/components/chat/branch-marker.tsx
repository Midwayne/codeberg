import { GitBranch } from 'lucide-react';

/** Divides the copied transcript from what this branch adds after it. */
export function BranchMarker({ parentTitle }: { parentTitle: string }) {
  return (
    <div role="status" className="branch-marker flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" aria-hidden="true" />

      <span className="flex min-w-0 items-center gap-1.5">
        <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          Branched from <span className="font-medium text-foreground">{parentTitle}</span>
        </span>
      </span>

      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
