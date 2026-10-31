import type { SetupProvider, SetupStatus } from '@agent/core/setup-types.js';

export type { SetupProvider, SetupRequired, SetupStatus } from '@agent/core/setup-types.js';

export type RootScreen = 'canvas' | 'docs' | 'setup' | 'app' | 'loading';

export const SETUP_DOCS_PATH = '/docs/getting-started';

/**
 * Read whether chat can start. A server that cannot answer (older build,
 * transient failure) opens the app as before rather than locking users out.
 */
export async function loadSetupStatus(fetchImpl: typeof fetch = fetch): Promise<SetupStatus> {
  try {
    const response = await fetchImpl('/api/setup');
    if (!response.ok) return { ready: true };

    return (await response.json()) as SetupStatus;
  } catch {
    return { ready: true };
  }
}

/** Until a usable chat model exists, every page except the canvas is documentation. */
export function rootScreen(path: string, status: SetupStatus | undefined): RootScreen {
  if (path === '/canvas') return 'canvas';

  const docs = isDocsPath(path);

  if (status === undefined) return docs ? 'docs' : 'loading';
  if (!status.ready) return 'setup';

  return docs ? 'docs' : 'app';
}

export function isDocsPath(path: string): boolean {
  return path === '/docs' || path.startsWith('/docs/');
}

export function configLines(provider: SetupProvider): string {
  return provider.missing.map((name) => `${name}=`).join('\n');
}
