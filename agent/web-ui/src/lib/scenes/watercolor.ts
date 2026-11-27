import { WATERCOLOR_BRUSH } from './watercolor-brush';

/*
 * Watercolor: a hibiscus painted with the watercolor brush, in washes of
 * deformed petal shapes from yellow tips to a crimson heart. The painting is
 * made once per size and shown still; a message or reply drops fresh paint.
 *
 * Runs as a theme scene (lib/scene): keep in plain JavaScript, no template
 * literals, since this text is the script itself.
 */
export const WATERCOLOR_SCENE = WATERCOLOR_BRUSH + String.raw`
const BLOT_SECONDS = 5;

/* One broad petal as a fan from the flower's middle, from an inner to an outer radius. */
function petal(flower, angle, inner, outer) {
  const points = [];
  const spread = 0.5;

  for (let i = 0; i <= 8; i += 1) {
    const a = angle - spread + (i / 8) * spread * 2;
    const bulge = outer * (0.82 + 0.18 * Math.cos((i / 8 - 0.5) * Math.PI));
    points.push({ x: flower.x + Math.cos(a) * bulge, y: flower.y + Math.sin(a) * bulge, v: 1 });
  }

  points.push({ x: flower.x + Math.cos(angle) * inner, y: flower.y + Math.sin(angle) * inner, v: 0.3 });

  return points;
}

function streaks(ctx, flower, angle, rand) {
  ctx.strokeStyle = '#9c1846';
  ctx.lineCap = 'round';

  for (let i = 0; i < 9; i += 1) {
    const a = angle + gaussian(rand) * 0.22;
    const reach = flower.r * (0.3 + rand() * 0.3);

    ctx.globalAlpha = 0.1 + rand() * 0.1;
    ctx.lineWidth = 0.8 + rand() * 2.4;
    ctx.beginPath();
    ctx.moveTo(flower.x, flower.y);
    ctx.lineTo(flower.x + Math.cos(a) * reach, flower.y + Math.sin(a) * reach);
    ctx.stroke();
  }
}

/* The long pistil reaching out from the middle, tipped with a speckled cluster. */
function stamen(ctx, flower, rand) {
  const a = flower.turn - 2.2;
  const tip = { x: flower.x + Math.cos(a) * flower.r * 0.72, y: flower.y + Math.sin(a) * flower.r * 0.72 };

  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = '#8d1640';
  ctx.lineWidth = Math.max(2, flower.r * 0.018);
  ctx.beginPath();
  ctx.moveTo(flower.x, flower.y);
  ctx.quadraticCurveTo(flower.x + Math.cos(a + 0.25) * flower.r * 0.4, flower.y + Math.sin(a + 0.25) * flower.r * 0.4, tip.x, tip.y);
  ctx.stroke();

  for (let i = 0; i < 46; i += 1) {
    ctx.globalAlpha = 0.35 + rand() * 0.5;
    ctx.fillStyle = i % 7 ? '#a3184c' : '#e9b04f';
    ctx.beginPath();
    ctx.arc(tip.x + gaussian(rand) * flower.r * 0.035, tip.y + gaussian(rand) * flower.r * 0.035, 0.8 + rand() * 1.8, 0, 7);
    ctx.fill();
  }
}

function paintFlower(ctx, flower, rand) {
  wash(ctx, ring(flower.x, flower.y, flower.r * 1.2), '#f2d6d2', 0.02, rand);

  for (let i = 0; i < 5; i += 1) {
    const angle = flower.turn + (i / 5) * Math.PI * 2;

    // Yellow pools at the tips of the upper petals only, as it does on a real hibiscus.
    if (i % 2 === 0) wash(ctx, petal(flower, angle, flower.r * 0.55, flower.r * 0.98), '#f0b553', 0.06, rand);
    wash(ctx, petal(flower, angle, 0, flower.r * (i % 2 ? 0.95 : 0.85)), '#e5729a', 0.05, rand);
    wash(ctx, petal(flower, angle, 0, flower.r * 0.42), '#b0234f', 0.055, rand);
    streaks(ctx, flower, angle, rand);
  }

  stamen(ctx, flower, rand);
}

function paintGrain(ctx, width, height, rand) {
  for (let i = 0; i < (width * height) / 260; i += 1) {
    ctx.globalAlpha = 0.04;
    ctx.fillStyle = rand() < 0.5 ? '#6b5440' : '#ffffff';
    ctx.fillRect(rand() * width, rand() * height, 1 + rand(), 1 + rand());
  }
}

/* A soft round drop of paint, made once and drawn growing and fading. */
function makeBlot(rand) {
  const canvas = new OffscreenCanvas(240, 240);
  const ctx = canvas.getContext('2d');
  wash(ctx, ring(120, 120, 80), '#e5729a', 0.05, rand);

  return canvas;
}

scene({
  keep: true,

  setup(s) {
    const page = new OffscreenCanvas(Math.round(s.width * s.dpr), Math.round(s.height * s.dpr));
    const ctx = page.getContext('2d');
    const rand = s.random(625);
    // Sized and placed to sit whole in the right margin, clear of the conversation column.
    const r = Math.max(120, Math.min(s.width * 0.15, s.height * 0.34));

    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    paintGrain(ctx, s.width, s.height, rand);
    ctx.globalCompositeOperation = 'multiply';
    paintFlower(ctx, { x: s.width - r * 0.95, y: s.height * 0.5, r, turn: -0.35 }, rand);
    paintFlower(ctx, { x: r * 0.35, y: s.height - r * 0.3, r: r * 0.6, turn: 0.9 }, rand);

    s.state.page = page;
    s.state.blot = s.state.blot || makeBlot(s.random(7));
    s.state.blots = s.state.blots || [];
    s.state.dirty = true;
  },

  frame(s) {
    const { ctx, state } = s;
    const wet = state.blots.length > 0;
    if (!state.dirty && !wet) return;

    state.blots = state.blots.filter((blot) => s.t - blot.at < BLOT_SECONDS);
    state.dirty = false;

    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, s.width, s.height);
    ctx.drawImage(state.page, 0, 0, s.width, s.height);

    for (const blot of state.blots) {
      const age = (s.t - blot.at) / BLOT_SECONDS;
      const size = blot.size * (0.35 + 0.65 * (1 - Math.pow(1 - Math.min(1, age * 2.5), 3)));

      ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.drawImage(state.blot, blot.x - size / 2, blot.y - size / 2, size, size);
    }
  },

  event(name, s) {
    if (name !== 'reply' && name !== 'send') return;

    const rand = s.random(Math.floor(s.t * 1000) + 1);
    const left = rand() < 0.5;

    s.state.blots.push({
      x: left ? s.width * (0.03 + rand() * 0.1) : s.width * (0.86 + rand() * 0.11),
      y: s.height * (0.1 + rand() * 0.8),
      size: 90 + rand() * 80,
      at: s.t,
    });
  },
});
`;
