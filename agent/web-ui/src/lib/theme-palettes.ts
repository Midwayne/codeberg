import { EXPRESSIVE_THEMES } from './theme-palettes-expressive';
import { GLOW_THEMES } from './theme-palettes-glow';
import { SCENE_THEMES } from './theme-palettes-scenes';

import type { CustomThemeId, Theme } from './theme-types';

export type { BackdropScene, Palette, Theme, ThemeFont } from './theme-types';

/* Minimal neutrals: crisp contrast, quiet surfaces, and only a faint halo of light. */
const BASE_THEMES = [
  {
    id: 'graphite',
    label: 'Graphite',
    description: 'Clean dark · soft halo',
    colorScheme: 'dark',
    radius: '0.75rem',
    backdrop: 'halo',
    transition: 'fade',
    palette: {
      background: '#111113',
      foreground: '#ededef',
      surface: '#0b0b0c',
      popover: '#1c1c1f',
      raised: '#1c1c1f',
      mutedForeground: '#a1a1aa',
      primary: '#ededef',
      primaryForeground: '#111113',
      destructive: '#f87171',
      border: '#ffffff12',
      input: '#ffffff1f',
      ring: '#8b8b94',
    },
  },
  {
    id: 'porcelain',
    label: 'Porcelain',
    description: 'Clean light · soft halo',
    colorScheme: 'light',
    radius: '0.75rem',
    backdrop: 'halo',
    transition: 'fade',
    palette: {
      background: '#ffffff',
      foreground: '#18181b',
      surface: '#f7f7f8',
      popover: '#ffffff',
      raised: '#f0f0f2',
      mutedForeground: '#5f5f68',
      primary: '#18181b',
      primaryForeground: '#ffffff',
      destructive: '#dc2626',
      secondaryForeground: '#18181b',
      destructiveForeground: '#ffffff',
      border: '#18181b14',
      input: '#18181b24',
      ring: '#71717a',
    },
  },
] as const satisfies readonly Theme[];

export const THEMES = [...BASE_THEMES, ...SCENE_THEMES, ...GLOW_THEMES, ...EXPRESSIVE_THEMES] as const;

export type BuiltinThemeId = (typeof THEMES)[number]['id'];

/** Applied on first visit and whenever a saved choice no longer exists. */
export const DEFAULT_THEME_ID = 'graphite' satisfies BuiltinThemeId;

export type ThemeId = BuiltinThemeId | CustomThemeId;
