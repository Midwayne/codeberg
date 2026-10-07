import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import {
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from 'react';

import { cn } from '../lib/utils';

export { Dialog, type DialogProps } from './dialog';

/** Quiet trigger, with native selection, labels, and keyboard behavior intact. */
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string };

export function Select({ className, wrapperClassName, ...props }: SelectProps) {
  return (
    <span className={cn('relative inline-flex min-w-0 max-w-full align-middle', wrapperClassName)}>
      <select
        {...props}
        className={cn(
          'peer min-h-11 min-w-0 max-w-full cursor-pointer appearance-none truncate rounded-md border-0 bg-transparent py-2 pl-2 pr-7 text-base font-medium text-foreground [field-sizing:content] transition-colors hover:text-accent-foreground focus-visible:text-accent-foreground disabled:cursor-default disabled:opacity-50 sm:text-sm [&>option]:bg-popover [&>option]:text-popover-foreground',
          className,
        )}
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
      />
    </span>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> };

export function IconButton({ className, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors sm:size-9',
        'hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}

export type ErrorNoticeProps = { title: string; detail: string; onRetry: () => void };

export function ErrorNotice({ title, detail, onRetry }: ErrorNoticeProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{title}</p>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-accent"
      >
        Try again
      </button>
    </div>
  );
}

export type CopyButtonProps = { text: string; className?: string; label?: string };

export function CopyButton({ text, className, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      className={className}
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

/**
 * A native <details> disclosure styled to match (used for reasoning and tool
 * panels). Native keeps it accessible and keyboard-toggleable with no state.
 */
export type CollapsibleProps = {
  icon?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function Collapsible({ icon, title, badge, defaultOpen = false, children }: CollapsibleProps) {
  return (
    <details
      open={defaultOpen}
      className="group/collapsible my-1 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/40"
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open/collapsible:rotate-90" />
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {badge}
      </summary>
      <div className="border-t border-border px-3 py-2">{children}</div>
    </details>
  );
}
