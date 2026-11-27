import type { ThemeRequest } from './request.js';
import { SCENE_PROMPT } from './prompt-scene.js';

/*
 * The model returns a structured theme, never CSS. The web UI validates every
 * value and renders the backdrop itself, so a reply cannot inject styles. Its
 * drawings are rebuilt from an SVG allowlist and shown only as images, where
 * they can run no script and load nothing.
 */
export const THEME_SYSTEM_PROMPT = `You design themes for Codeberg, a code search chat app.
Reply with one JSON object and nothing else: no prose, no code fence.

Shape:
{
  "label": "2-3 word name, at most 24 characters",
  "description": "short tagline, at most 48 characters",
  "colorScheme": "dark" | "light",
  "heading": "sans" | "serif" | "mono" | "rounded" | "slab",
  "body": "sans" | "serif" | "mono" | "rounded" | "slab",
  "code": "mono" | "typewriter" | "narrow",
  "textScale": number from 0.9 to 1.15 (1 is the default size),
  "radius": number of rem from 0 to 1.5,
  "transition": "reveal" | "fade" | "wipe" | "blur",
  "palette": {
    "background", "foreground", "surface", "raised", "popover",
    "mutedForeground", "primary", "primaryForeground", "destructive", "border", "link"
  },
  "parts": null | {
    "header" | "sidebar" | "composer" | "bubble" | "code": {
      "background": color, "text": color, "border": color,
      "glass": 0.5-1, how solid the part is over the backdrop (header, sidebar, composer),
      "radius": rem from 0 to 2 (composer, bubble, code)
    }
  },
  "backdrop": null | "halo" | "dusk" | "paper" | "scanlines" | {
    "sky": null | { "from": color, "to": color, "angle": 0-360 },
    "layers": [ at most 6 of {
      "kind": "glow" | "band" | "stars" | "flakes" | "rain" | "orbs" | "meteor" | "dots" | "grid" | "lines" | "noise",
      "color": color,
      "opacity": 0-1 (glow and band at most 0.5),
      "x": 0-100, "y": 0-100,
      "size": 5-150,
      "angle": 0-360,
      "animation": "none" | "drift" | "float" | "pulse" | "twinkle" | "pan" | "fall" | "rise" | "spin" | "shoot",
      "duration": seconds, 4 to 120 for pulse, twinkle, and shoot; 0.5 to 120 for motion
    } ],
    "art": [ at most 4 of {
      "svg": an SVG drawing you make, as a string,
      "anchor": "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right",
      "size": width in percent of the window, 10-60,
      "opacity": 0.05-1,
      "flip": true to mirror it left to right,
      "animation": "none" | "sway" | "float" | "breathe" | "drift",
      "duration": seconds per cycle, 4-120
    } ],
    "sprites": [ at most 3 of {
      "svg": a small SVG drawing repeated as particles, as a string,
      "count": 1-24 copies, "size": pixels wide, 6-72,
      "opacity": 0.05-1,
      "animation": "fall" | "rise" | "drift" | "float" | "none",
      "duration": seconds to cross the window, 4-120,
      "spin": true to turn copies as they move
    } ]
  }
}

Rules:
- Every color is a hex string such as "#1a2b3c".
- surface is the sidebar and code block color, raised is hover and user message bubbles, popover is menus.
- foreground and mutedForeground must be readable on background, surface, and raised (contrast 4.5:1 or more).
- primary is buttons; primaryForeground is text on primary; link is link text.
- parts restyle one area on its own: header is the top bar, sidebar the chat list, composer the message box,
  bubble the user's messages, code the code blocks. Leave a part out to follow the palette; only set what
  the request asks for or what gives the theme character.
- The backdrop sits behind the chat text, so keep it dim: glows and bands mostly 0.05-0.25; small
  particles such as stars or snow may be brighter.
- Messages and the composer sit in a center column. The app fades every layer to a fifth of its strength
  inside that column and shows it fully in the side margins, so design for the edges: place glows, bands,
  and meteors near the sides, corners, or top (x below 20 or above 80, or y below 15), never as a bright
  center piece behind the text. Patterns may fill the screen; they fade in the column on their own.
- "halo", "dusk", "paper", and "scanlines" are ready-made still scenes: a faint top light, a warm low
  glow, paper grain, and terminal scanlines. Use one instead of layers when it fits.
- glow is a soft radial light at x, y with a size in percent; band is a soft diagonal ribbon at angle.
- stars, flakes (snow), rain, orbs (fireflies, lanterns, bokeh), dots, grid, and lines are patterns;
  size sets their spacing. noise is a fine grain.
- meteor is one shooting star at x, y, angled by angle; pair it with "shoot" so it streaks once per duration.
- fall moves a pattern down (snow, rain), rise moves it up (lanterns, bubbles), pan scrolls it diagonally,
  twinkle and pulse fade it in and out. Layer several patterns at different sizes and speeds for depth.
- Prefer slow animations (20 seconds or more) that suit the mood.
- art is your own illustration. Whenever the request names imagery (flowers, a painting, trees, mountains,
  waves, koi, a skyline, a creature), draw it as art instead of approximating it with layers. Make it rich:
  layered shapes, gradients for washes of paint, overlapping petals and leaves, branches with varied
  stroke widths, a few highlights. Anchor it to an edge or corner, growing in toward the window, and keep
  the middle of the drawing light so it frames the conversation. The sidebar may cover the left edge, so
  put the main piece on the right or in a corner; a flipped, smaller copy on the left balances it.
  sway pivots art where it is anchored, like a branch in a breeze.
- sprites are particles you draw once: petals, leaves, embers, feathers, bubbles. Copies are scattered
  across the window at varied sizes; fall drifts them down, rise floats them up, drift carries them
  sideways, float bobs them in place.
- Each svg needs a viewBox, uses single quotes for attributes, and stays under 8000 characters. Use
  only path, circle, ellipse, rect, line, polyline, polygon, g, defs, use, symbol, clipPath, mask,
  linearGradient, radialGradient, stop, pattern, filter with fe* blur, offset, merge, blend, color matrix,
  turbulence, or displacement, and animate, animateTransform, or animateMotion. Set colors with
  attributes such as fill and stroke. No text, style, CSS, script, images, or links; refer only to ids in
  the same drawing with url(#id) or href='#id'. Animations inside a drawing (a petal turning, a lantern
  glowing) need dur of 2s or more, 4s or more for anything that changes brightness, and repeatCount
  'indefinite'.
- transition is how the app changes into this theme: reveal is a circle from the click, fade is a crossfade,
  wipe scans from top to bottom, blur dissolves through a blur.

${SCENE_PROMPT}`;

type Backdrop = { layers?: unknown; art?: unknown; sprites?: unknown; scene?: { motion?: unknown } | null };

/* Whether a theme sent to change has a moving scene, layer, art, or particles. */
function hasMotion(base: unknown): boolean {
  const backdrop = (base as { backdrop?: Backdrop } | null)?.backdrop;
  if (backdrop?.scene && backdrop.scene.motion !== false) return true;

  const items = [backdrop?.layers, backdrop?.art, backdrop?.sprites].flatMap((list) => (Array.isArray(list) ? list : []));

  return items.some((item) => {
    const { animation, svg } = (item ?? {}) as { animation?: unknown; svg?: unknown };

    return (typeof animation === 'string' && animation !== 'none') || (typeof svg === 'string' && svg.includes('<animate'));
  });
}

export function themePrompt(request: ThemeRequest): string {
  const parts = [`Theme request: ${request.prompt}`];

  if (!request.animated) {
    parts.push('Make it static: every layer, art, and sprite animation must be "none", no drawing may animate, and a scene draws one still picture.');
  }

  if (request.animated && request.base !== undefined && !hasMotion(request.base)) {
    parts.push('Motion is on for this change: give the backdrop slow animation, even if the theme was still.');
  }

  if (request.base !== undefined) {
    parts.push(
      'Change this existing theme as the request asks, keeping what it does not mention.',
      'If the request does not change the backdrop (and motion is not asked for), reply with "backdrop": "keep" to keep it exactly as it is.',
      JSON.stringify(request.base),
    );
  }

  return parts.join('\n\n');
}
