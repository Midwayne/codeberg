import { describe, expect, it } from 'vitest';

import { contrast } from './color';
import { normalizeTheme, ThemeShapeError } from './theme-normalize';

const options = { id: 'custom-test' as const, prompt: 'deep sea', animated: true };

describe('generated theme validation', () => {
  it('keeps a well-formed theme and derives its color scheme from the background', () => {
    const theme = normalizeTheme({
      label: 'Deep Sea',
      heading: 'serif',
      radius: 1.2,
      transition: 'blur',
      palette: { background: '#001122', foreground: '#e0f0ff', surface: '#00182c', primary: '#33ccff' },
    }, options);

    expect(theme).toMatchObject({ id: 'custom-test', label: 'Deep Sea', colorScheme: 'dark', heading: 'serif', radius: '1.2rem', transition: 'blur' });
    expect(theme.palette.foreground).toBe('#e0f0ff');
    expect(theme.palette.raised).toBe('#00182c');
  });

  it('repairs unreadable text and button labels instead of shipping them', () => {
    const { palette } = normalizeTheme({
      palette: { background: '#202020', foreground: '#252525', mutedForeground: '#2a2a2a', primary: '#ffcc00', primaryForeground: '#ffdd33' },
    }, options);

    expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.mutedForeground, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.primaryForeground!, palette.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back on unknown fonts, radii, and transitions, and refuses a theme with no usable background', () => {
    const theme = normalizeTheme({
      heading: 'comic-sans',
      radius: 40,
      transition: 'explode',
      palette: { background: '#fafafa', surface: 'red' },
    }, options);

    expect(theme).toMatchObject({ heading: 'sans', radius: '1.5rem', transition: 'reveal', colorScheme: 'light' });
    expect(theme.palette.surface).toBe('#fafafa');
    expect(() => normalizeTheme({ palette: { background: 'url(https://example.com/x.png)' } }, options)).toThrow(ThemeShapeError);
  });

  it('clamps backdrop layers, drops invalid ones, and freezes them when animation is off', () => {
    const layers = Array.from({ length: 9 }, (_, index) => ({
      kind: 'glow', color: index === 0 ? 'blue' : '#3366ff', opacity: 3, size: 900, animation: 'drift', duration: 1,
    }));

    const animated = normalizeTheme({ palette: { background: '#000000' }, backdrop: { layers } }, options).backdrop;
    const still = normalizeTheme({ palette: { background: '#000000' }, backdrop: { layers } }, { ...options, animated: false }).backdrop;

    expect(animated).toMatchObject({ layers: expect.any(Array) });
    expect(typeof animated === 'object' && animated.layers).toHaveLength(5);
    expect(typeof animated === 'object' && animated.layers[0]).toMatchObject({ opacity: 0.5, size: 150, duration: 4, animation: 'drift' });
    expect(typeof still === 'object' && still.layers.every((layer) => layer.animation === 'none')).toBe(true);
  });
});
