import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Root } from './setup/root';
import { applyTheme, loadTheme } from './lib/themes';
import { trackThemeOrigin } from './lib/theme-transition';
import { trackMotionInput } from './lib/motion-input';
import '@/index.css';
import '@/motion.css';
import '@/loading.css';
import '@/markdown.css';
import '@/backdrop.css';
import '@/theme-transition.css';

applyTheme(loadTheme());
import.meta.hot?.dispose(trackThemeOrigin());

const stopMotionInput = trackMotionInput();
import.meta.hot?.dispose(stopMotionInput);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
