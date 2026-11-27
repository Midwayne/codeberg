import { KOI_POND_SCENE } from './scenes/koi-pond';
import { NEON_HORIZON_SCENE } from './scenes/neon-horizon';
import { WATERCOLOR_SCENE } from './scenes/watercolor';
import { HIBISCUS_ART } from './scenes/hibiscus-art';
import { layer } from './theme-scene-layer';
import type { Theme } from './theme-types';

/*
 * Painted themes: each runs a canvas scene behind the app, and keeps a still
 * backdrop for Settings previews and for browsers that cannot run scenes.
 */
export const PAINTED_THEMES = [
  {
    id: 'watercolor',
    label: 'Watercolor',
    description: 'Hibiscus washes · paper grain',
    colorScheme: 'light',
    heading: 'serif',
    radius: '1rem',
    transition: 'fade',
    backdrop: {
      layers: [layer({ kind: 'noise', color: '#6b5440', opacity: 0.05 })],
      art: [{ svg: HIBISCUS_ART, anchor: 'right', size: 34, opacity: 0.85, flip: false, animation: 'none', duration: 16 }],
      scene: { script: WATERCOLOR_SCENE, motion: true },
    },
    parts: {
      bubble: { background: '#f3e3df', border: '#b8325a1f' },
    },
    palette: {
      background: '#f8f3ea',
      foreground: '#2b2420',
      surface: '#f2ebdf',
      popover: '#fffbf5',
      raised: '#ebe1d2',
      mutedForeground: '#685a50',
      primary: '#b8325a',
      primaryForeground: '#ffffff',
      destructive: '#b42318',
      destructiveForeground: '#ffffff',
      border: '#2b24201a',
      input: '#2b24202e',
      ring: '#a0506a',
      link: '#a12a50',
    },
  },
  {
    id: 'koi-pond',
    label: 'Koi Pond',
    description: 'Mosaic koi · ripples on reply',
    colorScheme: 'dark',
    radius: '0.5rem',
    transition: 'wipe',
    backdrop: {
      sky: { from: '#0b2a2e', to: '#082427', angle: 180 },
      layers: [
        layer({ kind: 'grid', color: '#1c5057', opacity: 0.6, size: 2 }),
        layer({ kind: 'glow', color: '#3a8f55', opacity: 0.22, x: 92, y: 14, size: 26 }),
        layer({ kind: 'glow', color: '#e2532f', opacity: 0.16, x: 8, y: 60, size: 22 }),
      ],
      scene: { script: KOI_POND_SCENE, motion: true },
    },
    palette: {
      background: '#0b2a2e',
      foreground: '#e4f2ef',
      surface: '#0e3135',
      popover: '#13393e',
      raised: '#123a3f',
      mutedForeground: '#9cbfba',
      primary: '#f08a4b',
      primaryForeground: '#1a0d05',
      destructive: '#ff7b72',
      border: '#ffffff14',
      input: '#ffffff24',
      ring: '#f08a4b',
      link: '#7fd8cf',
    },
  },
  {
    id: 'neon-horizon',
    label: 'Neon Horizon',
    description: 'Striped sun · fireworks on reply',
    colorScheme: 'dark',
    heading: 'serif',
    radius: '0.75rem',
    transition: 'reveal',
    backdrop: {
      sky: { from: '#120a2a', to: '#3b1650', angle: 180 },
      layers: [
        layer({ kind: 'stars', color: '#ffffff', opacity: 0.6, size: 90 }),
        layer({ kind: 'glow', color: '#ff7a6b', opacity: 0.3, x: 82, y: 58, size: 30 }),
        layer({ kind: 'grid', color: '#ff3fb4', opacity: 0.14, size: 30 }),
      ],
      scene: { script: NEON_HORIZON_SCENE, motion: true },
    },
    palette: {
      background: '#140a24',
      foreground: '#f6e9ff',
      surface: '#1c1030',
      popover: '#241540',
      raised: '#2a1742',
      mutedForeground: '#cbb6e0',
      primary: '#ff3fb4',
      primaryForeground: '#1a0612',
      destructive: '#ff6b6b',
      border: '#ffffff14',
      input: '#ffffff24',
      ring: '#ff3fb4',
      link: '#7af8ff',
    },
  },
] as const satisfies readonly Theme[];
