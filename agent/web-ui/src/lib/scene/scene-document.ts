/*
 * The document a scene runs in, loaded as the srcdoc of an iframe sandboxed to
 * `allow-scripts` alone: an opaque origin with no access to the app, its
 * storage, or its cookies, and no popups, forms, or top-level navigation. Its
 * CSP refuses every request, so neither it nor its worker can reach a network.
 *
 * The page's own script only relays: it starts the worker that runs the scene
 * (scene-worker.ts), forwards app events, and stops a worker that throws,
 * stalls, or stops answering, then tells the app so it can fall back.
 */
const BOOTSTRAP = String.raw`(() => {
  const canvas = document.querySelector('canvas');
  let worker = null;
  let pending = 0;
  let started = false;

  const report = (reason, detail) => {
    if (worker) worker.terminate();
    worker = null;
    parent.postMessage({ type: 'codeberg-scene', status: 'failed', reason, detail: String(detail || '').slice(0, 200) }, '*');
  };

  const dims = () => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 });

  /* A scene that does not answer within four seconds is stuck in a loop and is stopped. */
  const watch = () => {
    if (!worker) return;
    if (pending && performance.now() - pending > 4000) return report('unresponsive');
    if (!pending) { pending = performance.now(); worker.postMessage({ type: 'ping' }); }
  };

  const start = (data) => {
    if (started) return;
    started = true;
    if (typeof Worker !== 'function' || !canvas.transferControlToOffscreen) return report('unsupported');
    try {
      worker = new Worker(URL.createObjectURL(new Blob([String(data.source)], { type: 'text/javascript' })));
    } catch (error) {
      return report('unsupported', error && error.message);
    }
    worker.onerror = (event) => { event.preventDefault(); report('error', event.message); };
    worker.onmessage = (message) => {
      const reply = message.data || {};
      if (reply.type === 'pong') pending = 0;
      else if (reply.type === 'failed') report(String(reply.reason), reply.detail);
    };
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage(Object.assign({ type: 'init', canvas: offscreen, colors: data.colors, motion: data.motion }, dims()), [offscreen]);
    setInterval(watch, 1000);
    addEventListener('resize', resized);
    watchDensity();
  };

  /* A drag fires many resizes; the scene sets up again once the size settles, stretching until then. */
  let settle = 0;
  const resized = () => {
    clearTimeout(settle);
    settle = setTimeout(() => worker && worker.postMessage(Object.assign({ type: 'resize' }, dims())), 150);
  };

  /* Moving to a screen of another density fires no resize, so the density is watched on its own. */
  const watchDensity = () => {
    matchMedia('(resolution: ' + devicePixelRatio + 'dppx)').addEventListener('change', () => { resized(); watchDensity(); }, { once: true });
  };

  addEventListener('message', (message) => {
    if (message.source !== parent) return;
    const data = message.data || {};
    if (data.type === 'init') return start(data);
    if (worker && ['event', 'pause', 'resume'].includes(data.type)) worker.postMessage({ type: data.type, name: String(data.name || '') });
  });
})();`;

/** Sandbox tokens for the scene frame: scripts, and nothing else. */
export const SCENE_SANDBOX = 'allow-scripts';

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The scene frame's page; its color scheme matches the app so the browser keeps it transparent. */
export function sceneDocument(colorScheme: 'dark' | 'light'): string {
  const key = nonce();
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${key}' blob:`,
    'worker-src blob:',
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${policy}">`
    + `<style>:root{color-scheme:${colorScheme}}html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style>`
    + `</head><body><canvas></canvas><script nonce="${key}">${BOOTSTRAP}</script></body></html>`;
}
