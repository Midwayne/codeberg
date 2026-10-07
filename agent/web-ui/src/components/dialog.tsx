import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/utils';
import { useMotionPresence } from './motion-presence';

export type DialogProps = {
  open?: boolean;
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  motion?: 'center' | 'anchored' | 'drawer';
};

/** Native modality supplies focus containment, Escape, and background inertness. */
export function Dialog({ open = true, label, onClose, className, children, motion = 'center' }: DialogProps) {
  const present = useMotionPresence();
  const visible = open && present;
  const ref = useNativeDialog(visible);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-hidden={!visible || undefined}
      inert={!visible}
      data-ui-dialog={motion}
      onCancel={(event) => {
        event.preventDefault();
        ref.current?.close();
      }}
      onClose={() => {
        if (visible && ref.current && !ref.current.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      className={cn(
        'max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border-0 bg-popover p-0 text-popover-foreground shadow-xl',
        className,
      )}
    >
      <div className="flex h-full flex-col">{children}</div>
    </dialog>
  );
}

function useNativeDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useLayoutEffect(() => {
    const dialog = ref.current;

    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return ref;
}
