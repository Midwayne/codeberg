import { lazy, Suspense, useEffect } from 'react';

import { App } from '../App';
import { CanvasPage } from '../canvas/entry';
import { DocsLoading } from '../docs/loading';
import { SetupChecklist } from './checklist';
import { isDocsPath, rootScreen, SETUP_DOCS_PATH } from './status';
import { useSetupStatus } from './use-setup-status';

const DocsPage = lazy(() => import('../docs/page').then((module) => ({ default: module.DocsPage })));

/** Chooses the app, docs, or the docs-only setup guide for the current URL. */
export function Root({ path = window.location.pathname }: { path?: string }) {
  const setup = useSetupStatus();
  const screen = rootScreen(path, setup.status);
  const setupPath = screen === 'setup' && !isDocsPath(path) ? SETUP_DOCS_PATH : path;

  // Keep the address on a real docs page so docs navigation and history work.
  useEffect(() => {
    if (setupPath !== path) window.history.replaceState(null, '', setupPath);
  }, [path, setupPath]);

  switch (screen) {
    case 'canvas':
      return <CanvasPage />;
    case 'app':
      return <App />;
    case 'loading':
      return null;
    case 'docs':
    case 'setup':
      return (
        <Suspense fallback={<DocsLoading />}>
          <DocsPage
            path={setupPath}
            setup={setup.status?.ready === false && (
              <SetupChecklist
                status={setup.status}
                checking={setup.checking}
                stillMissing={setup.stillMissing}
                onCheck={setup.recheck}
              />
            )}
          />
        </Suspense>
      );
    default:
      return screen satisfies never;
  }
}
