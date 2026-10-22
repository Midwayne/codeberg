import { ExternalLink, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LinkSafetyModalProps } from 'streamdown';

import { CopyButton, Dialog, IconButton } from '../ui';

/** Keep the confirmation outside transcript paint containment and scroll clipping. */
export function renderLinkConfirmation(props: LinkSafetyModalProps) {
  if (!props.isOpen || typeof document === 'undefined') return null;

  return createPortal(<LinkConfirmation {...props} />, document.body);
}

function LinkConfirmation({ url, onClose, onConfirm }: LinkSafetyModalProps) {
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => cancel.current?.focus(), []);

  return (
    <Dialog label="Open external link?" onClose={onClose} className="m-auto w-md">
      <div className="min-w-0 space-y-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Open external link?</h2>
            <p className="text-sm leading-6 text-muted-foreground">You're about to visit an external website.</p>
          </div>
          <IconButton aria-label="Close link confirmation" onClick={onClose}>
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
        <div className="flex min-w-0 items-start gap-2 rounded-lg bg-muted p-3">
          <p className="max-h-32 min-w-0 flex-1 overflow-y-auto break-all font-mono text-xs leading-5">{url}</p>
          <CopyButton text={url} label="Copy link" />
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <button ref={cancel} type="button" onClick={onClose}
            className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-accent">
            Cancel
          </button>
          <button type="button" onClick={() => {
            onConfirm();
            onClose();
          }} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
            <ExternalLink aria-hidden="true" className="size-4" />
            Open link
          </button>
        </div>
      </div>
    </Dialog>
  );
}
