/*
 * Repeating particle patterns for backdrop layers. Each pattern scatters a few
 * points across one tile; tiling the background fills the screen. Points use
 * fractions of the tile so every spacing keeps the same arrangement.
 */
type Point = readonly [x: number, y: number, scale: number];

const STAR_POINTS: Point[] = [[0.08, 0.12, 1], [0.54, 0.31, 1], [0.35, 0.62, 1.5], [0.81, 0.81, 1], [0.92, 0.18, 1.5]];

const FLAKE_POINTS: Point[] = [[0.12, 0.2, 1], [0.62, 0.08, 0.7], [0.4, 0.55, 1.3], [0.85, 0.48, 0.9], [0.2, 0.86, 0.8], [0.7, 0.8, 1.1]];

const RAIN_POINTS: Point[] = [[0.06, 0.1, 1], [0.27, 0.62, 0.8], [0.45, 0.28, 1.1], [0.63, 0.78, 0.9], [0.8, 0.4, 1], [0.94, 0.9, 0.7]];

const ORB_POINTS: Point[] = [[0.18, 0.3, 1], [0.66, 0.15, 0.6], [0.48, 0.72, 0.8], [0.88, 0.62, 1.2]];

function scatter(points: Point[], tile: number, draw: (x: number, y: number, scale: number) => string): string {
  return points.map(([x, y, scale]) => draw(Math.round(x * tile), Math.round(y * tile), scale)).join(', ');
}

export function stars(color: string, tile: number): string {
  return scatter(STAR_POINTS, tile, (x, y, scale) => `radial-gradient(${scale}px ${scale}px at ${x}px ${y}px, ${color}, transparent)`);
}

/** Soft round flakes of a few sizes. */
export function flakes(color: string, tile: number): string {
  return scatter(FLAKE_POINTS, tile, (x, y, scale) => {
    const radius = (1.6 * scale).toFixed(1);

    return `radial-gradient(circle at ${x}px ${y}px, ${color} 0 ${radius}px, transparent ${radius}px calc(${radius}px + 1.5px))`;
  });
}

/** Thin, tall drops whose length grows with the spacing. */
export function rain(color: string, tile: number): string {
  const length = Math.round(tile / 9);

  return scatter(RAIN_POINTS, tile, (x, y, scale) => `radial-gradient(0.7px ${Math.round(length * scale)}px at ${x}px ${y}px, ${color}, transparent)`);
}

/** Large soft lights, such as fireflies, lanterns, or bokeh. */
export function orbs(color: string, tile: number): string {
  const radius = Math.max(2, Math.round(tile / 70));

  return scatter(ORB_POINTS, tile, (x, y, scale) => {
    const core = Math.round(radius * scale);

    return `radial-gradient(circle at ${x}px ${y}px, ${color} 0 ${core}px, transparent ${core * 3}px)`;
  });
}
