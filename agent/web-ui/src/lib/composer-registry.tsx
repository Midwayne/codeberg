import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

type ComposerRegistryApi = {
  register: (node: HTMLElement) => void;
  unregister: (node: HTMLElement) => void;
  elements: () => HTMLElement[];
};

const ComposerRegistryContext = createContext<ComposerRegistryApi | null>(null);

const noComposers = (): HTMLElement[] => [];

export function ComposerRegistry({ children }: { children: ReactNode }) {
  const nodes = useRef(new Set<HTMLElement>());
  const api = useMemo<ComposerRegistryApi>(() => ({
    register(node) {
      nodes.current.add(node);
    },
    unregister(node) {
      nodes.current.delete(node);
    },
    elements() {
      return Array.from(nodes.current);
    },
  }), []);

  return <ComposerRegistryContext.Provider value={api}>{children}</ComposerRegistryContext.Provider>;
}

export function useComposerSlot(): (node: HTMLElement | null) => void {
  const registry = useContext(ComposerRegistryContext);
  const current = useRef<HTMLElement | null>(null);

  return useCallback((node: HTMLElement | null) => {
    if (current.current) {
      registry?.unregister(current.current);
      current.current = null;
    }

    if (!registry || !node) return;

    current.current = node;
    registry.register(node);
  }, [registry]);
}

export function useComposerElements(): () => HTMLElement[] {
  const registry = useContext(ComposerRegistryContext);

  return registry?.elements ?? noComposers;
}

export function visibleComposer(elements: readonly HTMLElement[]): HTMLElement | undefined {
  return elements.find((element) => element.getClientRects().length > 0) ?? elements[0];
}
