import { useEffect, useState } from 'react';

import { useFocusFirst } from './focus-registry';

/** The deleted dialog and trigger disappear; move focus to a surviving control. */
export function useProjectDeletionFocus() {
  const focusFirst = useFocusFirst();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) return;

    focusFirst();
    setPending(false);
  }, [pending, focusFirst]);

  return () => setPending(true);
}
