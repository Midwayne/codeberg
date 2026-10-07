import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import { applyTheme, loadTheme } from '../lib/themes';
import { trackMotionInput } from '../lib/motion-input';
import { installDemoApi } from './api';
import '@/index.css';
import '@/motion.css';
import '@/loading.css';
import './style.css';

const delay = Number(new URL(location.href).searchParams.get('delay') ?? 1500);
installDemoApi(Number.isFinite(delay) ? Math.max(0, Math.min(5000, delay)) : 1500);
applyTheme(loadTheme());
import.meta.hot?.dispose(trackMotionInput());

function Demo() {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs">
        <span className="font-medium">Motion demo · simulated requests</span>
        <label className="ml-auto flex items-center gap-2">
          Loading delay
          <select aria-label="Loading delay" defaultValue={delay} className="rounded border border-border bg-background p-1"
            onChange={(event) => {
              const url = new URL(location.href);
              url.searchParams.set('delay', event.currentTarget.value);
              location.assign(url);
            }}>
            <option value={0}>Instant</option>
            <option value={1500}>1.5 seconds</option>
            <option value={3000}>3 seconds</option>
          </select>
        </label>
        <button className="rounded border border-border px-2 py-1 hover:bg-accent" onClick={() => location.reload()}>
          Replay loading
        </button>
      </div>
      <div className="demo-workspace min-h-0 flex-1"><App /></div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
