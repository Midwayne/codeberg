import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { CanvasPage } from './canvas/entry';
import { applyTheme, loadTheme } from './lib/themes';
import { trackMotionInput } from './lib/motion-input';
import '@/index.css';
import '@/motion.css';
import '@/loading.css';

applyTheme(loadTheme());

const stopMotionInput = trackMotionInput();
import.meta.hot?.dispose(stopMotionInput);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/canvas' ? <CanvasPage /> : <App />}
  </StrictMode>,
);
