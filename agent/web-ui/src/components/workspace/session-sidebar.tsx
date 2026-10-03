import { Archive, ArchiveRestore, GitBranch, MessageSquarePlus, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { SessionSummary } from '@/lib/sessions';
import { cn, timeAgo } from '@/lib/utils';
import { Dialog, IconButton } from '@/components/ui';

/** Chat organization is only a view over the same resumable conversations. */
export function SessionSidebar({
  projectControls,
  sidebarActions,
  sessions,
  error,
  currentId,
  canBranch,
  onResume,
  onNew,
  onBranch,
  onDelete,
  onSetFlags,
}: {
  projectControls?: ReactNode;
  sidebarActions?: ReactNode;
  sessions: SessionSummary[];
  error?: string;
  currentId: string;
  canBranch: boolean;
  onResume: (id: string) => void;
  onNew: () => void;
  onBranch: () => void;
  onDelete: (id: string) => void;
  onSetFlags: (id: string, flags: { pinned?: boolean; archived?: boolean }) => void;
}) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [menu, setMenu] = useState<{ id: string; top: number; left: number }>();
  const [deleting, setDeleting] = useState<SessionSummary>();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target))) setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenu(undefined); triggerRef.current?.focus(); }
    };
    const close = () => setMenu(undefined);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);
  const visible = sessions.filter((s) => s.archived === (view === 'archived'));
  const groups = [
    { label: 'Pinned', items: visible.filter((s) => s.pinned) },
    { label: view === 'archived' ? 'Archived' : 'Recent', items: visible.filter((s) => !s.pinned) },
  ];

  return (
    <aside id="chat-sidebar" className="flex min-h-0 w-full flex-1 flex-col bg-card/30 md:w-72 md:flex-none md:border-r md:border-border" aria-label="Chats">
      <div className="space-y-4 p-3">
        <div className="flex min-w-0 items-center gap-1">{projectControls}{sidebarActions}</div>
        <div className="flex items-center gap-2">
        <button type="button" onClick={onNew} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <MessageSquarePlus className="size-4" />New chat
        </button>
        <IconButton onClick={onBranch} disabled={!canBranch} aria-label="Branch chat" title="Copy this chat into a new session" className="size-11 border border-border sm:size-11">
          <GitBranch className="size-4" />
        </IconButton>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1" role="group" aria-label="Chat view">
          {(['active', 'archived'] as const).map((name) => (
            <button key={name} type="button" onClick={() => setView(name)} aria-pressed={view === name} className={cn('min-h-10 flex-1 rounded-md px-2 py-2 text-xs capitalize hover:bg-accent', view === name ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground')}>
              {name}<span className="ml-2 tabular-nums opacity-70">{sessions.filter((session) => session.archived === (name === 'archived')).length}</span>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {visible.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{view === 'archived' ? 'No archived chats yet.' : 'No saved chats yet.'}</p>}
        {groups.filter((group) => group.items.length > 0).map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-3">
            <h2 className="px-2 pt-4 pb-2 text-xs font-medium text-muted-foreground">{group.label}</h2>
            <ul className="space-y-0.5">
              {group.items.map((s) => (
                <li key={s.id} className={cn('group/sess flex items-center gap-0.5 rounded-lg pr-1 text-sm transition-colors hover:bg-accent', s.id === currentId && 'bg-accent')}>
                  <button type="button" onClick={() => onResume(s.id)} aria-current={s.id === currentId ? 'true' : undefined} className="min-w-0 flex-1 px-2 py-3 text-left" title={s.title}>
                    <span className="flex min-w-0 items-center gap-1">
                      {s.parentId && <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-label="Branched chat" />}
                      <span className="line-clamp-2 leading-5 text-foreground">{s.title}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {timeAgo(s.updatedAt)} · {s.turns} turn{s.turns === 1 ? '' : 's'}
                    </span>
                  </button>
                  <IconButton onClick={(event) => {
                    if (menu?.id === s.id) { setMenu(undefined); return; }
                    triggerRef.current = event.currentTarget;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setMenu({ id: s.id, top: Math.max(8, Math.min(bounds.bottom, window.innerHeight - 124)), left: Math.max(8, bounds.right - 160) });
                  }} aria-label={`Actions for ${s.title}`} aria-expanded={menu?.id === s.id} aria-haspopup="menu" className="hover:bg-background">
                    <MoreHorizontal className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {menu && sessions.find((s) => s.id === menu.id) && <div ref={menuRef} className="fixed z-50 w-40 rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-xl" style={{ top: menu.top, left: menu.left }}>
        <SessionActionsMenu session={sessions.find((s) => s.id === menu.id)!} onAction={(action) => {
          const s = sessions.find((item) => item.id === menu.id)!;
          setMenu(undefined);
          triggerRef.current?.focus();
          if (action === 'pin') onSetFlags(s.id, { pinned: !s.pinned });
          if (action === 'archive') onSetFlags(s.id, { archived: !s.archived });
          if (action === 'delete') setDeleting(s);
        }} />
      </div>}
      {deleting && <DeleteChatDialog title={deleting.title} onClose={() => { setDeleting(undefined); triggerRef.current?.focus(); }} onDelete={() => { onDelete(deleting.id); setDeleting(undefined); }} />}
    </aside>
  );
}

export function DeleteChatDialog({ title, onClose, onDelete }: { title: string; onClose: () => void; onDelete: () => void }) {
  return <Dialog label="Delete chat" onClose={onClose} className="m-auto w-[min(28rem,calc(100vw-2rem))]">
    <div className="p-6">
      <h2 className="text-lg font-semibold">Delete this chat?</h2>
      <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">“{title}” will be permanently deleted. This cannot be undone.</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} className="min-h-11 rounded-lg border border-border px-4 text-sm hover:bg-accent">Cancel</button>
        <button type="button" onClick={onDelete} className="min-h-11 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:opacity-90">Delete chat</button>
      </div>
    </div>
  </Dialog>;
}

export function SessionActionsMenu({ session, onAction }: {
  session: SessionSummary;
  onAction: (action: 'pin' | 'archive' | 'delete') => void;
}) {
  return <div role="menu" aria-label={`Actions for ${session.title}`} onKeyDown={(event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}>
    <button type="button" role="menuitem" onClick={() => onAction('pin')} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent">{session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}{session.pinned ? 'Unpin' : 'Pin'}</button>
    <button type="button" role="menuitem" onClick={() => onAction('archive')} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent">{session.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}{session.archived ? 'Unarchive' : 'Archive'}</button>
    <button type="button" role="menuitem" onClick={() => onAction('delete')} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-destructive hover:bg-accent"><Trash2 className="size-3.5" />Delete</button>
  </div>;
}
