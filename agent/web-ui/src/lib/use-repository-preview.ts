import { useEffect, useState } from 'react';

import { toggled } from '../components/repository-choices';
import { previewRepositories, type RepositoryPreview } from './repository-requests';

const PREVIEW_DELAY_MS = 300;

/** Absolute POSIX or Windows paths; anything else waits for more typing. */
function absolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

/** Previews the repositories in `root` as it is typed and tracks the folders left unchecked. */
export function useRepositoryPreview(root: string) {
  const [preview, setPreview] = useState<RepositoryPreview>();
  const [ignored, setIgnored] = useState<string[]>([]);

  useEffect(() => {
    setPreview(undefined);
    setIgnored([]);

    const path = root.trim();
    if (!absolute(path)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      previewRepositories(path, controller.signal)
        .then(setPreview)
        .catch(() => undefined);
    }, PREVIEW_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [root]);

  const toggleRepository = (path: string) => setIgnored((current) => toggled(current, path));

  return { preview, ignored, toggleRepository, setIgnored };
}
