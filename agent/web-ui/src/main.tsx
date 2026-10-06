import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { CanvasPage } from './canvas/entry';
import { applyTheme, loadTheme } from './lib/themes';
import '@/index.css';

applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname === '/canvas' ? <CanvasPage /> : <App />}
  </StrictMode>,
);
