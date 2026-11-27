/*
 * A still hibiscus for Watercolor's preview and fallback: five petals shaded
 * from a crimson heart to yellow tips, their edges roughened by turbulence
 * like pigment soaking into paper.
 */
const petal = (turn: number) =>
  `<g transform='rotate(${turn})'><path d='M0 0 C 40 -70, 150 -95, 185 -30 C 205 20, 150 85, 80 70 C 40 62, 12 30, 0 0Z' fill='url(#wash)' opacity='0.72'/></g>`;

export const HIBISCUS_ART = [
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-220 -220 440 440'>",
  "<defs><radialGradient id='wash' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='200'>",
  "<stop offset='0' stop-color='#a3184c'/><stop offset='0.3' stop-color='#d65a86'/><stop offset='0.62' stop-color='#ee9fb6'/><stop offset='0.9' stop-color='#f0b553'/></radialGradient>",
  "<filter id='bleed'><feTurbulence type='fractalNoise' baseFrequency='0.035' numOctaves='2' seed='4'/><feDisplacementMap in='SourceGraphic' scale='16'/></filter></defs>",
  "<g filter='url(#bleed)'>",
  [0, 72, 144, 216, 288].map((turn) => petal(turn - 20)).join(''),
  "<path d='M0 0 Q -40 -70, -95 -125' stroke='#8d1640' stroke-width='4' fill='none' stroke-linecap='round'/>",
  "<circle cx='-95' cy='-125' r='9' fill='#a3184c'/><circle cx='-104' cy='-118' r='4' fill='#e9b04f'/><circle cx='-88' cy='-133' r='3.5' fill='#e9b04f'/>",
  '</g></svg>',
].join('');
