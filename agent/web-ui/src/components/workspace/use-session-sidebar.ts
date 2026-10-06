import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type SessionSummary } from '../../lib/sessions';

export type SessionSidebarOptions = {
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
};

export function useSessionSidebar({
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
}: SessionSidebarOptions) {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [menu, setMenu] = useState<{ id: string; top: number; left: number }>();
  const [deleting, setDeleting] = useState<SessionSummary>();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useSidebarMenuFocus({ menu, menuRef, triggerRef, setMenu });

  const visible = sessions.filter((s) => s.archived === (view === 'archived'));
  const groups = [
    { label: 'Pinned', items: visible.filter((s) => s.pinned) },
    { label: view === 'archived' ? 'Archived' : 'Recent', items: visible.filter((s) => !s.pinned) },
  ];
  return {
    projectControls,
    sidebarActions,
    onNew,
    onBranch,
    canBranch,
    setView,
    view,
    sessions,
    error,
    visible,
    groups,
    currentId,
    onResume,
    menu,
    setMenu,
    triggerRef,
    menuRef,
    onSetFlags,
    setDeleting,
    deleting,
    onDelete,
  };
}

export type SidebarMenuFocusOptions = {
  menu: { id: string; top: number; left: number } | undefined;
  menuRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  setMenu: React.Dispatch<React.SetStateAction<{ id: string; top: number; left: number } | undefined>>;
};

export function useSidebarMenuFocus({ menu, menuRef, triggerRef, setMenu }: SidebarMenuFocusOptions) {
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target))
      )
        setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(undefined);
        triggerRef.current?.focus();
      }
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
}
