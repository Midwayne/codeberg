import { Archive, ArchiveRestore, Pin, PinOff, Trash2 } from 'lucide-react';

import { type SessionSummary } from '../../lib/sessions';

import { Dialog } from '../ui';
import { MotionPresence } from '../motion-presence';
import { type SidebarMenuProps, type SidebarDeleteProps } from './session-sidebar';

export type DeleteChatDialogProps = {
  title: string;
  onClose: () => void;
  onDelete: () => void;
};

export function DeleteChatDialog({ title, onClose, onDelete }: DeleteChatDialogProps) {
  return (
    <Dialog label="Delete chat" onClose={onClose} className="m-auto w-[min(28rem,calc(100vw-2rem))]">
      <div className="p-6">
        <h2 className="text-lg font-semibold">Delete this chat?</h2>
        <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
          “{title}” will be permanently deleted. This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="min-h-11 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:opacity-90"
          >
            Delete chat
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export type SessionActionsMenuProps = {
  session: SessionSummary;
  onAction: (action: 'pin' | 'archive' | 'delete') => void;
};

export function SessionActionsMenu({ session, onAction }: SessionActionsMenuProps) {
  return (
    <div
      role="menu"
      aria-label={`Actions for ${session.title}`}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onAction('pin')}
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent"
      >
        {session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        {session.pinned ? 'Unpin' : 'Pin'}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onAction('archive')}
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent"
      >
        {session.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
        {session.archived ? 'Unarchive' : 'Archive'}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onAction('delete')}
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-destructive hover:bg-accent"
      >
        <Trash2 className="size-3.5" />
        Delete
      </button>
    </div>
  );
}

export function SidebarMenu({ state }: SidebarMenuProps) {
  return (
    state.menu &&
    state.sessions.find((s) => s.id === state.menu!.id) && (
      <div
        ref={state.menuRef}
        className="fixed z-50 w-40 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl"
        style={{ top: state.menu.top, left: state.menu.left }}
      >
        <SessionActionsMenu
          session={state.sessions.find((s) => s.id === state.menu!.id)!}
          onAction={(action) => {
            const s = state.sessions.find((item) => item.id === state.menu!.id)!;
            state.setMenu(undefined);
            state.triggerRef.current?.focus();
            if (action === 'pin') state.onSetFlags(s.id, { pinned: !s.pinned });
            if (action === 'archive') state.onSetFlags(s.id, { archived: !s.archived });
            if (action === 'delete') state.setDeleting(s);
          }}
        />
      </div>
    )
  );
}

export function SidebarDelete({ state }: SidebarDeleteProps) {
  return (
    <MotionPresence visible={Boolean(state.deleting)}>
      {state.deleting && (
        <DeleteChatDialog
          title={state.deleting.title}
          onClose={() => {
            state.setDeleting(undefined);
            state.triggerRef.current?.focus();
          }}
          onDelete={() => {
            state.onDelete(state.deleting!.id);
            state.setDeleting(undefined);
          }}
        />
      )}
    </MotionPresence>
  );
}
