import { Loader2 } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '../lib/utils';
import { LoadingSkeleton, type LoadingKind } from './loading-skeleton';

export type LoadingBoundaryProps = {
  loading: boolean;
  contentReady?: boolean;
  label: string;
  kind?: LoadingKind;
  className?: string;
  children?: ReactNode;
};

/** Both layers share a grid cell, so fading never moves neighboring content. */
export function LoadingBoundary({ loading, contentReady = !loading, label, kind = 'section', className, children }: LoadingBoundaryProps) {
  return (
    <div className={cn('ui-loading-boundary', className)} data-kind={kind} aria-busy={loading}>
      <div className="ui-loaded-content" data-ready={contentReady} inert={!contentReady} aria-hidden={!contentReady || undefined}>
        {children}
      </div>
      <div
        className="ui-loading-surface"
        data-present={loading}
        role={loading ? 'status' : undefined}
        aria-hidden={!loading || undefined}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="ui-loading-indicator size-4 shrink-0" />
          <span>{label}</span>
        </div>
        <LoadingSkeleton kind={kind} />
      </div>
    </div>
  );
}

export function LoadingStatus({ active = true, label, className }: { active?: boolean; label: string; className?: string }) {
  return (
    <div
      className={cn('ui-loading-status flex min-h-5 items-center gap-2 text-xs text-muted-foreground', className)}
      data-present={active}
      role={active ? 'status' : undefined}
      aria-hidden={!active || undefined}
    >
      <Loader2 aria-hidden="true" className="ui-loading-indicator size-3.5 shrink-0" />
      <span>{label}</span>
    </div>
  );
}
