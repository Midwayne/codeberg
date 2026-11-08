import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

export const FOCUS_SLOTS = ['projectsHeading', 'projectSelect', 'addProject', 'settings'] as const;

export type FocusSlot = (typeof FOCUS_SLOTS)[number];

type FocusEntry = { slot: FocusSlot; node: HTMLElement };

type FocusRegistryApi = {
  register: (entry: FocusEntry) => void;
  unregister: (entry: FocusEntry) => void;
  focusFirst: () => void;
};

const FocusRegistryContext = createContext<FocusRegistryApi | null>(null);

export function FocusRegistry({ children }: { children: ReactNode }) {
  const entries = useRef<FocusEntry[]>([]);
  const api = useMemo<FocusRegistryApi>(() => ({
    register(entry) {
      entries.current = [...entries.current, entry];
    },
    unregister(entry) {
      entries.current = entries.current.filter((item) => item !== entry);
    },
    focusFirst() {
      firstFocusable(entries.current)?.focus();
    },
  }), []);

  return <FocusRegistryContext.Provider value={api}>{children}</FocusRegistryContext.Provider>;
}

export function firstFocusable(entries: readonly FocusEntry[]): HTMLElement | undefined {
  for (const slot of FOCUS_SLOTS) {
    const match = entries.find((entry) => entry.slot === slot && visible(entry.node));

    if (match) return match.node;
  }

  return undefined;
}

function visible(node: HTMLElement): boolean {
  return node.getClientRects().length > 0 && !node.closest('[inert]');
}

export function useFocusSlot<Element extends HTMLElement = HTMLElement>(slot: FocusSlot): (node: Element | null) => void {
  const registry = useContext(FocusRegistryContext);
  const entry = useRef<FocusEntry | null>(null);

  return useCallback((node: Element | null) => {
    if (entry.current) {
      registry?.unregister(entry.current);
      entry.current = null;
    }

    if (!registry || !node) return;

    entry.current = { slot, node };
    registry.register(entry.current);
  }, [registry, slot]);
}

export function useFocusFirst(): () => void {
  const registry = useContext(FocusRegistryContext);

  return registry?.focusFirst ?? noop;
}

function noop(): void {}
