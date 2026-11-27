/*
 * Koi Pond: a mosaic pond. The tiles and lily pads are laid once per size;
 * koi swim slow loops near the edges, each body a chain of segments trailing
 * the head and snapped to the tile grid; a message or reply sends a ripple.
 *
 * Runs as a theme scene (lib/scene): keep in plain JavaScript, no template
 * literals, since this text is the script itself.
 */
export const KOI_POND_SCENE = String.raw`
const TILE = 14;

/* Tiles either side of the spine, head to tail: a full body, a narrow wrist, a forked tail. */
const WIDTH = [1, 2, 2, 2, 2, 1, 1, 0, 0, 1];
const WATER = ['#0d3237', '#0e363b', '#10393e', '#123f44', '#14444a'];
const LEAF = ['#2a6e41', '#2f7d4a', '#3a8f55'];
const RIPPLE_SECONDS = 3;

/* Scales in body order, head first: kohaku, showa, and ogon patterns. */
const COATS = [
  ['#f4efe6', '#e2532f', '#e2532f', '#f4efe6', '#e2532f', '#f4efe6', '#f4efe6', '#e2532f', '#f4efe6', '#f4efe6'],
  ['#1c1a1a', '#e2532f', '#f4efe6', '#1c1a1a', '#e2532f', '#1c1a1a', '#f4efe6', '#1c1a1a', '#e2532f', '#1c1a1a'],
  ['#f2b134', '#f2b134', '#f6c65a', '#f2b134', '#e9a320', '#f6c65a', '#f2b134', '#e9a320', '#f2b134', '#f6c65a'],
];

function tile(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x / TILE) * TILE + 1, Math.round(y / TILE) * TILE + 1, TILE - 2, TILE - 2);
}

function layWater(ctx, width, height, rand) {
  ctx.fillStyle = '#082427';
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += TILE) {
    for (let x = 0; x < width; x += TILE) {
      const depth = 0.5 + 0.5 * Math.sin(x * 0.004 + y * 0.006);
      tile(ctx, x, y, WATER[Math.min(4, Math.floor(rand() * 3 + depth * 2))]);
    }
  }
}

/* A round pad, in tiles, with a wedge cut from it; some carry a pink lotus. */
function layPad(ctx, pad, rand) {
  const radius = pad.r * TILE;

  for (let dy = -radius; dy <= radius; dy += TILE) {
    for (let dx = -radius; dx <= radius; dx += TILE) {
      const angle = Math.atan2(dy, dx);
      const notch = Math.abs(Math.atan2(Math.sin(angle - pad.notch), Math.cos(angle - pad.notch))) < 0.32;

      if (Math.hypot(dx, dy) <= radius && !notch) tile(ctx, pad.x + dx, pad.y + dy, LEAF[Math.floor(rand() * 3)]);
    }
  }

  if (!pad.lotus) return;

  for (const [dx, dy, color] of [[0, 0, '#f6d36b'], [-1, 0, '#f0a6c0'], [1, 0, '#f0a6c0'], [0, -1, '#f7c4d6'], [0, 1, '#e889ab'], [-1, -1, '#f7c4d6'], [1, -1, '#f7c4d6']]) {
    tile(ctx, pad.x + dx * TILE, pad.y + dy * TILE, color);
  }
}

/* Slow loops that keep to the margins and the top and bottom edges. */
function makeFish(width, height) {
  return [
    { cx: 0.1, cy: 0.42, ax: 0.07, ay: 0.3, speed: 0.11, phase: 0, coat: 0 },
    { cx: 0.12, cy: 0.62, ax: 0.08, ay: 0.22, speed: -0.09, phase: 2, coat: 2 },
    { cx: 0.9, cy: 0.38, ax: 0.07, ay: 0.28, speed: -0.1, phase: 1, coat: 1 },
    { cx: 0.88, cy: 0.7, ax: 0.08, ay: 0.2, speed: 0.12, phase: 4, coat: 0 },
    { cx: 0.5, cy: 0.94, ax: 0.42, ay: 0.03, speed: 0.04, phase: 3, coat: 2 },
  ].map((fish) => ({ ...fish, cx: fish.cx * width, cy: fish.cy * height, ax: fish.ax * width, ay: fish.ay * height }));
}

function swimAt(fish, u) {
  return { x: fish.cx + fish.ax * Math.cos(u), y: fish.cy + fish.ay * Math.sin(u) };
}

/* Each segment sits a little further back along the path, widened across the swimming direction. */
function drawFish(ctx, fish, t) {
  const u = fish.phase + fish.speed * t;
  const lag = (TILE * 0.9) / Math.max(fish.ax, fish.ay) * Math.sign(fish.speed);

  for (let k = COATS[fish.coat].length - 1; k >= 0; k -= 1) {
    const at = swimAt(fish, u - k * lag);
    const ahead = swimAt(fish, u - (k - 1) * lag);
    const across = Math.atan2(ahead.y - at.y, ahead.x - at.x) + Math.PI / 2;
    const color = COATS[fish.coat][k];

    for (let j = -WIDTH[k]; j <= WIDTH[k]; j += 1) {
      // The tail fork leaves its middle open; flanks take the next scale's color for patches.
      if (k === COATS[fish.coat].length - 1 && j === 0) continue;

      const flank = Math.abs(j) === 2 ? COATS[fish.coat][(k + 1) % COATS[fish.coat].length] : color;
      tile(ctx, at.x + Math.cos(across) * TILE * j, at.y + Math.sin(across) * TILE * j, flank);
    }
  }
}

function drawRipple(ctx, ripple, t) {
  const age = (t - ripple.at) / RIPPLE_SECONDS;
  const radius = 10 + age * 90;
  const steps = Math.max(12, Math.round(radius / 4));

  ctx.globalAlpha = 0.45 * (1 - age);

  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    tile(ctx, ripple.x + Math.cos(a) * radius, ripple.y + Math.sin(a) * radius, '#9fe7e0');
  }

  ctx.globalAlpha = 1;
}

scene({
  setup(s) {
    const pond = new OffscreenCanvas(Math.round(s.width * s.dpr), Math.round(s.height * s.dpr));
    const ctx = pond.getContext('2d');
    const rand = s.random(31);
    const { width: w, height: h } = s;

    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    layWater(ctx, w, h, rand);

    for (const pad of [
      { x: w * 0.07, y: h * 0.18, r: 5, notch: 0.6, lotus: false },
      { x: w * 0.94, y: h * 0.12, r: 6, notch: 2.4, lotus: true },
      { x: w * 0.91, y: h * 0.72, r: 7, notch: 4, lotus: false },
      { x: w * 0.05, y: h * 0.8, r: 6, notch: 5.2, lotus: true },
      { x: w * 0.74, y: h * 0.06, r: 4, notch: 1.4, lotus: false },
    ]) {
      layPad(ctx, pad, rand);
    }

    s.state.pond = pond;
    s.state.fish = makeFish(w, h);
    s.state.ripples = s.state.ripples || [];
  },

  frame(s) {
    const { ctx, state } = s;

    ctx.drawImage(state.pond, 0, 0, s.width, s.height);

    state.ripples = state.ripples.filter((ripple) => s.t - ripple.at < RIPPLE_SECONDS);
    for (const ripple of state.ripples) drawRipple(ctx, ripple, s.t);

    for (const fish of state.fish) drawFish(ctx, fish, s.t);
  },

  event(name, s) {
    if (name !== 'reply' && name !== 'send') return;

    // Ripple where a koi is, as if it rose to the surface.
    const fish = s.state.fish[Math.floor(s.t * 7) % s.state.fish.length];
    const at = swimAt(fish, fish.phase + fish.speed * s.t);

    s.state.ripples.push({ x: at.x, y: at.y, at: s.t });
  },
});
`;
