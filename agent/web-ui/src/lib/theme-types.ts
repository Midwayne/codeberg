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
export type BackdropScene = 'halo' | 'dusk' | 'paper' | 'scanlines';

/** How the app changes into a theme. */
export const THEME_TRANSITIONS = ['reveal', 'fade', 'wipe', 'blur'] as const;

export type ThemeTransition = (typeof THEME_TRANSITIONS)[number];

export const LAYER_KINDS = ['glow', 'band', 'stars', 'flakes', 'rain', 'orbs', 'meteor', 'dots', 'grid', 'lines', 'noise'] as const;

export const LAYER_ANIMATIONS = ['none', 'drift', 'float', 'pulse', 'twinkle', 'pan', 'fall', 'rise', 'spin', 'shoot'] as const;

/** One validated layer of a generated backdrop; the UI turns it into styles. */
export interface BackdropLayer {
  kind: (typeof LAYER_KINDS)[number];
  color: string;
  /** 0 to 0.5. */
  opacity: number;
  /** Position in percent, 0 to 100. */
  x: number;
  y: number;
  /** Glow size in percent, or pattern spacing in pixels. */
  size: number;
  /** Degrees, for bands and lines. */
  angle: number;
  animation: (typeof LAYER_ANIMATIONS)[number];
  /** Seconds per cycle: 4 to 120 for generated themes; built-in rain may be faster. */
  duration: number;
}

/** A backdrop designed by the chat model: an optional sky and up to six layers. */
export interface CustomBackdrop {
  sky?: { from: string; to: string; angle: number };
  layers: BackdropLayer[];
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
