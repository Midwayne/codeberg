import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { CanvasPage } from './canvas/entry';
import { DocsLoading } from './docs/loading';
import { applyTheme, loadTheme } from './lib/themes';
import { trackMotionInput } from './lib/motion-input';
import '@/index.css';
import '@/motion.css';
import '@/loading.css';

const DocsPage = lazy(() => import('./docs/page').then((module) => ({ default: module.DocsPage })));

applyTheme(loadTheme());

const stopMotionInput = trackMotionInput();
import.meta.hot?.dispose(stopMotionInput);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/docs' || location.pathname.startsWith('/docs/') ? (
      <Suspense fallback={<DocsLoading />}>
        <DocsPage />
      </Suspense>
    ) : location.pathname === '/canvas' ? <CanvasPage /> : <App />}
  </StrictMode>,
);
