import { useEffect, useState } from 'react';

/** The deleted dialog and trigger disappear; move focus to a surviving control. */
export function useProjectDeletionFocus() {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) return;

    const targets = ['[data-projects-heading]', 'select[aria-label="Project"]', '[data-add-project]', 'button[aria-label="Settings"]'];
    const target = targets.map((selector) => document.querySelector<HTMLElement>(selector))
      .find((element) => element && element.getClientRects().length > 0 && !element.closest('[inert]'));
    target?.focus();
    setPending(false);
  }, [pending]);

  return () => setPending(true);
}
