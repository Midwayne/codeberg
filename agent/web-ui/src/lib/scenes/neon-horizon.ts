/*
 * Neon Horizon: a striped sun setting behind wireframe mountains over a
 * perspective grid that scrolls toward the viewer, under faint stars;
 * fireworks burst over the margins when a reply finishes.
 *
 * Runs as a theme scene (lib/scene): keep in plain JavaScript, no template
 * literals, since this text is the script itself.
 */
export const NEON_HORIZON_SCENE = String.raw`
const BURST_SECONDS = 2.6;
const SPARK_COLORS = ['#ff3fb4', '#ffd56b', '#7af8ff'];
const PEAKS = [[0, 0], [0.06, 0.14], [0.11, 0.06], [0.17, 0.2], [0.24, 0.04], [0.3, 0]];

function drawSky(ctx, w, horizon, stars, t) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#120a2a');
  sky.addColorStop(0.7, '#3b1650');
  sky.addColorStop(1, '#7a2463');

  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  ctx.fillStyle = '#ffffff';
  for (const star of stars) {
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 0.8 + star.phase);
    ctx.fillRect(star.x * w, star.y * horizon, star.r, star.r);
  }

  ctx.globalAlpha = 1;
}

/* The sun is cut by bands that slide down slowly, as on a retro poster. */
function drawSun(ctx, w, h, horizon, t) {
  const r = Math.min(w, h) * 0.24;
  const cx = w * 0.78;
  const cy = horizon - h * 0.06;
  const fill = ctx.createLinearGradient(0, cy - r, 0, cy + r);

  fill.addColorStop(0, '#ffd56b');
  fill.addColorStop(0.5, '#ff7a6b');
  fill.addColorStop(1, '#ff2fa0');

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = fill;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i += 1) {
    const y = cy + r * (0.1 + i * 0.13) - ((t * 6) % (r * 0.13));
    ctx.fillRect(cx - r, y, r * 2, 2 + i * 1.6);
  }

  ctx.restore();
}

function drawMountains(ctx, w, h, horizon) {
  ctx.strokeStyle = '#c13cff';
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.8;

  for (const mirrored of [false, true]) {
    ctx.beginPath();
    PEAKS.forEach(([px, py], i) => {
      const x = mirrored ? w - px * w : px * w;
      const y = horizon - py * h;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/* Lines fan out from the vanishing point; cross lines bunch toward the horizon and scroll in. */
function drawGrid(ctx, w, h, horizon, t) {
  const floor = ctx.createLinearGradient(0, horizon, 0, h);
  floor.addColorStop(0, '#2a0b3d');
  floor.addColorStop(1, '#0c0518');

  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.strokeStyle = '#ff3fb4';
  ctx.lineWidth = 1;

  ctx.globalAlpha = 0.55;
  for (let i = -24; i <= 24; i += 1) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + i * 8, horizon);
    ctx.lineTo(w / 2 + i * w * 0.09, h);
    ctx.stroke();
  }

  const shift = (t * 0.35) % 1;
  for (let i = 0; i < 14; i += 1) {
    const depth = (i + shift) / 14;
    const y = horizon + (h - horizon) * depth * depth;

    ctx.globalAlpha = 0.15 + depth * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/* Sparks fly out, fall under gravity, and fade. */
function drawBursts(ctx, bursts, t) {
  for (const burst of bursts) {
    const age = t - burst.at;
    if (age < 0) continue;

    ctx.globalAlpha = Math.max(0, 1 - age / BURST_SECONDS);

    for (const spark of burst.sparks) {
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(burst.x + spark.vx * age * 90, burst.y + spark.vy * age * 90 + 40 * age * age, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
}

function burst(x, y, at, rand) {
  const sparks = Array.from({ length: 48 }, (_, i) => {
    const angle = (i / 48) * Math.PI * 2;
    const speed = 0.6 + rand() * 0.6;

    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color: SPARK_COLORS[i % 3] };
  });

  return { x, y, at, sparks };
}

scene({
  setup(s) {
    const rand = s.random(7);

    s.state.stars = Array.from({ length: 140 }, () => ({ x: rand(), y: rand() * 0.9, r: rand() * 1.3 + 0.3, phase: rand() * 6 }));
    s.state.bursts = s.state.bursts || [];
  },

  frame(s) {
    const { ctx, width: w, height: h, t, state } = s;
    const horizon = h * 0.62;

    drawSky(ctx, w, horizon, state.stars, t);
    drawSun(ctx, w, h, horizon, t);
    drawMountains(ctx, w, h, horizon);
    drawGrid(ctx, w, h, horizon, t);

    state.bursts = state.bursts.filter((item) => t - item.at < BURST_SECONDS);
    drawBursts(ctx, state.bursts, t);
  },

  event(name, s) {
    if (name !== 'reply') return;

    const rand = s.random(Math.floor(s.t * 1000) + 1);

    // Three staggered bursts over the margins: two on the left, one on the right.
    for (let k = 0; k < 3; k += 1) {
      const x = k === 1 ? s.width * 0.88 : s.width * (0.06 + rand() * 0.12);
      s.state.bursts.push(burst(x, s.height * (0.15 + rand() * 0.2), s.t + k * 0.35, rand));
    }
  },
});
`;
