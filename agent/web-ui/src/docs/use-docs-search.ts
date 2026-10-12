import { useEffect, useState } from 'react';

export function useDocsSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      setOpen((current) => !current);
    };

    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}
