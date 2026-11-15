import { useState } from 'react';

import { Dialog } from '../ui';
import { MotionPresence } from '../motion-presence';
import type { SidebarRenameProps } from './session-sidebar';

/** Mirrors the server's limit so an overlong title is stopped while typing. */
const MAX_TITLE_LENGTH = 200;

export type RenameChatDialogProps = {
  title: string;
  onClose: () => void;
  onRename: (title: string) => void;
};

export function RenameChatDialog({ title, onClose, onRename }: RenameChatDialogProps) {
  const [value, setValue] = useState(title);
  const next = value.replace(/\s+/g, ' ').trim();

  return (
    <Dialog label="Rename chat" onClose={onClose} className="m-auto w-[min(28rem,calc(100vw-2rem))]">
      <form
        className="p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!next) return;

          if (next !== title) onRename(next);
          onClose();
        }}
      >
        <h2 className="text-lg font-semibold">Rename chat</h2>

        <label htmlFor="rename-chat-title" className="mt-4 block text-sm font-medium">
          Chat title
        </label>
        <input
          id="rename-chat-title"
          autoFocus
          required
          maxLength={MAX_TITLE_LENGTH}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
        />

        <RenameChatActions disabled={!next} onClose={onClose} />
      </form>
    </Dialog>
  );
}

type RenameChatActionsProps = { disabled: boolean; onClose: () => void };

function RenameChatActions({ disabled, onClose }: RenameChatActionsProps) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-accent"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Save title
      </button>
    </div>
  );
}

export function SidebarRename({ state }: SidebarRenameProps) {
  const close = () => {
    state.setRenaming(undefined);
    state.triggerRef.current?.focus();
  };

  return (
    <MotionPresence visible={Boolean(state.renaming)}>
      {state.renaming && (
        <RenameChatDialog
          key={state.renaming.id}
          title={state.renaming.title}
          onClose={close}
          onRename={(title) => state.onRename(state.renaming!.id, title)}
        />
      )}
    </MotionPresence>
  );
}
