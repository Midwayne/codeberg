/*
 * The runtime around a model-written scene script. It runs in a Worker inside
 * the sandboxed scene frame (scene-document.ts): no DOM, no app origin, and a
 * CSP that refuses every network request. The script gets a canvas and calls
 * `scene({ setup, frame, event })`; this runtime owns the frame loop, so it
 * can hold a scene still, pause it, and stop one that is too slow or throws.
 *
 * Kept as source text because it is loaded into the worker from a Blob.
 */
export const SCENE_WORKER_RUNTIME = String.raw`'use strict';
const send = self.postMessage.bind(self);
const listen = self.addEventListener.bind(self);
const timer = self.setTimeout.bind(self);
const animate = typeof self.requestAnimationFrame === 'function' ? self.requestAnimationFrame.bind(self) : (step) => timer(() => step(performance.now()), 16);
const now = () => performance.now();

/* The frame's CSP is what refuses network requests; hiding these first only makes a script fail fast. */
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker']) {
  try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch {}
}

let definition = null;
const s = { ctx: null, canvas: null, width: 0, height: 0, dpr: 1, t: 0, dt: 0, colors: {}, motion: true, state: {} };
let running = false;
let begun = 0;
let last = 0;
let cost = 0;
let skip = false;
let stopped = false;

self.scene = (value) => { definition = value; };

s.random = (seed) => {
  let x = (seed | 0) || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1e6) / 1e6; };
};

function fail(reason, error) {
  if (stopped) return;
  stopped = true;
  running = false;
  send({ type: 'failed', reason, detail: error ? String(error && error.message || error).slice(0, 200) : '' });
}

function call(name, ...args) {
  const hook = definition && definition[name];
  if (typeof hook !== 'function') return;
  try { hook.apply(definition, args); } catch (error) { fail('error', error); }
}

function size(data) {
  s.width = Math.max(1, data.width);
  s.height = Math.max(1, data.height);
  s.dpr = Math.min(2, data.dpr || 1);
  s.canvas.width = Math.round(s.width * s.dpr);
  s.canvas.height = Math.round(s.height * s.dpr);
  s.ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
}

function paint() {
  if (!definition || !definition.keep) s.ctx.clearRect(0, 0, s.width, s.height);
  const start = now();
  call('frame', s);
  cost = cost * 0.9 + (now() - start) * 0.1;
}

/* At most 60 frames a second; a scene that costs over 12 ms a frame drops to 30, over 40 ms it stops. */
function loop(time) {
  if (!running || stopped) return;
  animate(loop);
  if (time - last < 15) return;
  skip = cost > 12 && !skip;
  if (skip) return;
  s.dt = Math.min(0.1, (time - last) / 1000);
  s.t = (time - begun) / 1000;
  last = time;
  paint();
  if (s.t > 3 && cost > 40) fail('slow');
}

function resume() {
  if (running || stopped || !s.motion) return;
  running = true;
  last = now();
  begun = last - s.t * 1000;
  animate(loop);
}

function init(data) {
  s.canvas = data.canvas;
  s.ctx = s.canvas.getContext('2d');
  s.colors = data.colors || {};
  s.motion = data.motion !== false;
  size(data);
  if (!definition) return fail('no-scene');
  call('setup', s);
  if (s.motion) resume();
  else paint();
}

listen('message', (message) => {
  const data = message.data || {};
  if (data.type === 'ping') return send({ type: 'pong' });
  if (stopped) return;
  if (data.type === 'init') return init(data);
  if (data.type === 'resize') { size(data); call('setup', s); if (!running) paint(); return; }
  if (data.type === 'pause') { running = false; return; }
  if (data.type === 'resume') return resume();
  if (data.type === 'event' && s.motion) call('event', String(data.name), s);
});
`;

/** The worker's source: the runtime, then the scene script in its own strict scope. */
export function sceneWorkerSource(script: string): string {
  return `${SCENE_WORKER_RUNTIME}\n;(function () {\n'use strict';\n${script}\n}).call(undefined);\n`;
}
