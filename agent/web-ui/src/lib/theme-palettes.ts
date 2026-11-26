import { EXPRESSIVE_THEMES } from './theme-palettes-expressive';
import { SCENE_THEMES } from './theme-palettes-scenes';

import type { CustomThemeId, Theme } from './theme-types';

export type { BackdropScene, Palette, Theme, ThemeFont } from './theme-types';

const BASE_THEMES = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Codex · soft charcoal',
    colorScheme: 'dark',
    palette: {
      background: '#212121',
      foreground: '#dcdcdc',
      surface: '#181818',
      popover: '#303030',
      raised: '#303030',
      mutedForeground: '#afafaf',
      primary: '#dcdcdc',
      primaryForeground: '#212121',
      destructive: 'oklch(0.704 0.191 22.216)',
      border: '#ffffff14',
      input: '#ffffff26',
      ring: '#8f8f8f',
    },
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Codex · soft grey',
    colorScheme: 'light',
    palette: {
      background: '#f5f5f5',
      foreground: '#282828',
      surface: '#ededed',
      popover: '#ffffff',
      raised: '#e8e8e8',
      mutedForeground: '#5d5d5d',
      primary: '#303030',
      primaryForeground: '#f5f5f5',
      destructive: 'oklch(0.577 0.245 27.325)',
      secondaryForeground: '#282828',
      destructiveForeground: '#ffffff',
      border: '#0d0d0d14',
      input: '#0d0d0d26',
      ring: '#767676',
    },
  },
] as const satisfies readonly Theme[];

export const THEMES = [...BASE_THEMES, ...EXPRESSIVE_THEMES, ...SCENE_THEMES] as const;

export type BuiltinThemeId = (typeof THEMES)[number]['id'];

export type ThemeId = BuiltinThemeId | CustomThemeId;
