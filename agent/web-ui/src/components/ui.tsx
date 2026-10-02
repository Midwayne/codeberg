import { AlertTriangle, Check, ChevronRight, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';

import { cn } from '@/lib/utils';

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
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

/** Native modality supplies focus containment, Escape, and background inertness. */
export function Dialog({ open = true, label, onClose, className, children }: {
  open?: boolean;
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    return () => {
      if (!dialog.open) return;
      dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [open]);
  return (
    <dialog ref={ref} aria-label={label} onCancel={(event) => { event.preventDefault(); ref.current?.close(); }}
      onClose={() => { if (ref.current && !ref.current.open) onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) ref.current?.close(); }}
      className={cn('max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-0 bg-popover p-0 text-popover-foreground shadow-xl', className)}>
      <div className="flex h-full flex-col">{children}</div>
    </dialog>
  );
}

export function ErrorNotice({ title, detail, onRetry }: { title: string; detail: string; onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
    <div className="min-w-0 flex-1 text-sm"><p className="font-medium">{title}</p><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{detail}</p></div>
    <button type="button" onClick={onRetry} className="min-h-11 rounded-lg border border-border px-3 text-sm hover:bg-accent">Try again</button>
  </div>;
}


export function CopyButton({
  text,
  className,
  label = 'Copy',
}: {
  text: string;
  className?: string;
  label?: string;
}) {
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
export function Collapsible({
  icon,
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
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
