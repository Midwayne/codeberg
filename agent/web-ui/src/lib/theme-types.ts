export interface Palette {
  background: string;
  foreground: string;
  surface: string;
  popover?: string;
  raised: string;
  mutedForeground: string;
  primary: string;
  destructive: string;
  border: string;
  primaryForeground?: string;
  secondaryForeground?: string;
  destructiveForeground?: string;
  accent?: string;
  input?: string;
  ring?: string;
  /** Link text; defaults to primary. */
  link?: string;
}

export const THEME_FONTS = ['sans', 'serif', 'mono', 'rounded', 'slab'] as const;

export type ThemeFont = (typeof THEME_FONTS)[number];

export const CODE_FONTS = ['mono', 'typewriter', 'narrow'] as const;

export type CodeFont = (typeof CODE_FONTS)[number];

/** The parts of the app a theme can style on their own. */
export const THEME_PARTS = ['header', 'sidebar', 'composer', 'bubble', 'code'] as const;

export type ThemePart = (typeof THEME_PARTS)[number];

/** One part's look; anything left out follows the palette. */
export interface PartStyle {
  background?: string;
  text?: string;
  border?: string;
  /** How solid the part is over a backdrop, 0.5 (glassy) to 1 (solid). */
  glass?: number;
  /** Corner radius in rem, for the composer, bubble, and code parts. */
  radius?: number;
}

/** Built-in scenes drawn by backdrop.css. */
export const BACKDROP_SCENES = ['halo', 'dusk', 'paper', 'scanlines'] as const;

export type BackdropScene = (typeof BACKDROP_SCENES)[number];

/** How the app changes into a theme. */
export const THEME_TRANSITIONS = ['reveal', 'fade', 'wipe', 'blur'] as const;

export type ThemeTransition = (typeof THEME_TRANSITIONS)[number];

export const LAYER_KINDS = ['glow', 'band', 'stars', 'flakes', 'rain', 'orbs', 'meteor', 'dots', 'grid', 'lines', 'noise'] as const;

export const LAYER_ANIMATIONS = ['none', 'drift', 'float', 'pulse', 'twinkle', 'pan', 'fall', 'rise', 'spin', 'shoot'] as const;

/** One validated layer of a generated backdrop; the UI turns it into styles. */
export interface BackdropLayer {
  kind: (typeof LAYER_KINDS)[number];
  color: string;
  /** 0 to 1; glows and bands, which sit behind text as broad light, at most 0.5. */
  opacity: number;
  /** Position in percent, 0 to 100. */
  x: number;
  y: number;
  /** Glow size in percent, or pattern spacing in pixels. */
  size: number;
  /** Degrees, for bands and lines. */
  angle: number;
  animation: (typeof LAYER_ANIMATIONS)[number];
  /** Seconds per cycle, to 120: brightness changes (pulse, twinkle, shoot) 4 or more, motion 0.5 or more. */
  duration: number;
}

/** Where a piece of art sits: an edge or corner of the window. */
export const ART_ANCHORS = ['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export type ArtAnchor = (typeof ART_ANCHORS)[number];

/** How a whole piece of art moves; the drawing may also animate inside. */
export const ART_ANIMATIONS = ['none', 'sway', 'float', 'breathe', 'drift'] as const;

/** An illustration the chat model drew, such as a flowering branch along one side. */
export interface BackdropArt {
  /** Sanitized SVG with a viewBox. */
  svg: string;
  anchor: ArtAnchor;
  /** Width as a percent of the window, 10 to 60. */
  size: number;
  opacity: number;
  /** Mirrored left to right, so one drawing can face in from either side. */
  flip: boolean;
  animation: (typeof ART_ANIMATIONS)[number];
  /** Seconds per cycle, 4 to 120. */
  duration: number;
}

export const SPRITE_ANIMATIONS = ['none', 'fall', 'rise', 'drift', 'float'] as const;

/** A small drawing repeated as scattered particles, such as petals or leaves. */
export interface BackdropSprite {
  /** Sanitized SVG with a viewBox. */
  svg: string;
  /** Copies scattered across the window, 1 to 24. */
  count: number;
  /** Width of each copy in pixels, 6 to 72; copies vary around it. */
  size: number;
  opacity: number;
  animation: (typeof SPRITE_ANIMATIONS)[number];
  /** Seconds for one copy to cross the window, 4 to 120. */
  duration: number;
  /** Whether copies turn as they move. */
  spin: boolean;
}

/** A backdrop designed by the chat model: an optional sky, up to six layers, and its own art. */
export interface CustomBackdrop {
  sky?: { from: string; to: string; angle: number };
  layers: BackdropLayer[];
  art?: BackdropArt[];
  sprites?: BackdropSprite[];
}

export interface Theme {
  id: string;
  label: string;
  description: string;
  colorScheme: 'dark' | 'light';
  palette: Palette;
  /** Typeface for headings; defaults to sans. */
  heading?: ThemeFont;
  /** Typeface for body text; defaults to sans. */
  body?: ThemeFont;
  /** Typeface for code; defaults to mono. */
  code?: CodeFont;
  /** Text size relative to the default, 0.9 to 1.15. */
  textScale?: number;
  /** Per-part styles for the header, sidebar, composer, message bubbles, and code blocks. */
  parts?: Partial<Record<ThemePart, PartStyle>>;
  /** Base corner radius; defaults to 0.625rem. */
  radius?: string;
  /** Scene drawn behind the conversation; none when omitted. */
  backdrop?: BackdropScene | CustomBackdrop;
  /** How the app changes into this theme; defaults to reveal. */
  transition?: ThemeTransition;
}

export type CustomThemeId = `custom-${string}`;

/** A theme the chat model designed, saved in this browser. */
export interface CustomTheme extends Theme {
  id: CustomThemeId;
  /** What the user asked for, kept so the theme can be refined later. */
  prompt: string;
}
