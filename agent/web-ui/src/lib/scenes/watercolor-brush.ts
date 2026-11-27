/*
 * A watercolor brush for theme scenes: shapes deformed by repeated midpoint
 * displacement and painted as many faint, multiplied glazes, so edges pool
 * and feather like pigment on wet paper. Scene source text, prepended to a
 * scene that paints with it; plain JavaScript without template literals.
 */
export const WATERCOLOR_BRUSH = String.raw`
const WASH_LAYERS = 18;

function gaussian(rand) {
  return Math.sqrt(-2 * Math.log(rand() || 1e-6)) * Math.cos(2 * Math.PI * rand());
}

/* Inserts a displaced midpoint on every edge, depth times; v is how far each vertex may wander. */
function deform(points, depth, variance, rand) {
  let shape = points;

  for (let pass = 0; pass < depth; pass += 1) {
    const next = [];

    for (let i = 0; i < shape.length; i += 1) {
      const a = shape[i];
      const b = shape[(i + 1) % shape.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const v = (a.v + b.v) / 2;

      next.push(a, {
        x: (a.x + b.x) / 2 + gaussian(rand) * length * variance * v,
        y: (a.y + b.y) / 2 + gaussian(rand) * length * variance * v,
        v: v * (0.85 + rand() * 0.3),
      });
    }

    shape = next;
  }

  return shape;
}

/* Many faint glazes of one shape, multiplied so overlaps deepen like real pigment. */
function wash(ctx, shape, color, alpha, rand) {
  const base = deform(shape, 2, 0.28, rand);

  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;

  for (let layer = 0; layer < WASH_LAYERS; layer += 1) {
    const glaze = deform(base, 3, 0.16, rand);

    ctx.beginPath();
    glaze.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.fill();
  }
}

/* A rough circle of points, for round washes. */
function ring(x, y, radius) {
  return Array.from({ length: 12 }, (_, i) => ({ x: x + Math.cos((i / 12) * Math.PI * 2) * radius, y: y + Math.sin((i / 12) * Math.PI * 2) * radius, v: 1 }));
}
`;
