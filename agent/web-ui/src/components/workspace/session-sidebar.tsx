import { Archive, ArchiveRestore, GitBranch, MessageSquarePlus, MoreHorizontal, Pin, PinOff, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { SessionSummary } from '@/lib/sessions';
import { cn, timeAgo } from '@/lib/utils';

/** Chat organization is only a view over the same resumable conversations. */
export function SessionSidebar({
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
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(undefined); triggerRef.current?.focus(); }
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
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/30" aria-label="Chats">
      <div className="space-y-2 p-2">
        <button type="button" onClick={onNew} className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent">
          <MessageSquarePlus className="size-4" />New chat
        </button>
        <button type="button" onClick={onBranch} disabled={!canBranch} title="Copy this chat into a new session" className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40">
          <GitBranch className="size-4" />Branch chat
        </button>
        <div className="flex gap-1" role="group" aria-label="Chat view">
          {(['active', 'archived'] as const).map((name) => (
            <button key={name} type="button" onClick={() => setView(name)} aria-pressed={view === name} className={cn('flex-1 rounded-md px-2 py-1.5 text-xs capitalize hover:bg-accent', view === name ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
              {name}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{view === 'archived' ? 'No archived chats yet.' : 'No saved chats yet.'}</p>}
        {groups.filter((group) => group.items.length > 0).map((group) => (
          <section key={group.label} aria-label={group.label} className="mb-3">
            <h2 className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</h2>
            <ul className="space-y-0.5">
              {group.items.map((s) => (
                <li key={s.id} className={cn('group/sess flex items-center gap-0.5 rounded-md pr-1 text-xs transition-colors hover:bg-accent', s.id === currentId && 'bg-accent')}>
                  <button type="button" onClick={() => onResume(s.id)} aria-current={s.id === currentId ? 'true' : undefined} className="min-w-0 flex-1 px-2 py-1.5 text-left" title={s.title}>
                    <span className="flex min-w-0 items-center gap-1">
                      {s.parentId && <GitBranch className="size-3 shrink-0 text-muted-foreground" aria-label="Branched chat" />}
                      <span className="truncate text-foreground">{s.title}</span>
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {timeAgo(s.updatedAt)} · {s.turns} turn{s.turns === 1 ? '' : 's'}
                    </span>
                  </button>
                  <button type="button" onClick={(event) => {
                    if (menu?.id === s.id) { setMenu(undefined); return; }
                    triggerRef.current = event.currentTarget;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setMenu({ id: s.id, top: Math.max(8, Math.min(bounds.bottom, window.innerHeight - 124)), left: Math.max(8, bounds.right - 160) });
                  }} aria-label={`Actions for ${s.title}`} aria-expanded={menu?.id === s.id} aria-haspopup="menu" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground">
                    <MoreHorizontal className="size-4" />
                  </button>
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
          if (action === 'delete') onDelete(s.id);
        }} />
      </div>}
    </aside>
  );
}

export function SessionActionsMenu({ session, onAction }: {
  session: SessionSummary;
  onAction: (action: 'pin' | 'archive' | 'delete') => void;
}) {
  return <div role="menu" aria-label={`Actions for ${session.title}`}>
    <button type="button" role="menuitem" onClick={() => onAction('pin')} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent">{session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}{session.pinned ? 'Unpin' : 'Pin'}</button>
    <button type="button" role="menuitem" onClick={() => onAction('archive')} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent">{session.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}{session.archived ? 'Unarchive' : 'Archive'}</button>
    <button type="button" role="menuitem" onClick={() => onAction('delete')} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-destructive hover:bg-accent"><Trash2 className="size-3.5" />Delete</button>
  </div>;
}
