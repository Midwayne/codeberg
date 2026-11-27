import { describe, expect, it } from 'vitest';

import { contrast, mix } from './color';
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
    expect(typeof animated === 'object' && animated.layers[0]).toMatchObject({ opacity: 0.5, size: 150, duration: 1, animation: 'drift' });
    expect(typeof still === 'object' && still.layers.every((layer) => layer.animation === 'none')).toBe(true);
  });

  it('keeps shooting-star motion on shooting stars only', () => {
    const backdrop = normalizeTheme({
      palette: { background: '#000000' },
      backdrop: { layers: [
        { kind: 'stars', color: '#ffffff', animation: 'shoot' },
        { kind: 'meteor', color: '#ffffff', animation: 'drift' },
        { kind: 'meteor', color: '#ffffff', animation: 'shoot' },
      ] },
    }, options).backdrop;

    expect(typeof backdrop === 'object' && backdrop.layers.map((layer) => layer.animation)).toEqual(['none', 'none', 'shoot']);
  });

  it('styles parts on their own with readable text, and drops what does not apply', () => {
    const theme = normalizeTheme({
      code: 'typewriter',
      textScale: 3,
      palette: { background: '#101010', foreground: '#eeeeee' },
      parts: {
        header: { background: '#1c1c1c', text: '#333333', glass: 0.1, radius: 1 },
        bubble: { background: '#1a2a55', text: '#2a4ab0', radius: 1.25 },
        footer: { background: '#ff0000' },
      },
    }, options);

    expect(theme).toMatchObject({ code: 'typewriter', textScale: 1.15 });
    expect(Object.keys(theme.parts ?? {})).toEqual(['header', 'bubble']);
    expect(theme.parts?.header).toMatchObject({ glass: 0.5 });
    expect(theme.parts?.header?.radius).toBeUndefined();
    expect(contrast(theme.parts!.header!.text!, theme.parts!.header!.background!)).toBeGreaterThanOrEqual(4.5);
    expect(theme.parts?.bubble?.radius).toBe(1.25);
    expect(contrast(theme.parts!.bubble!.text!, theme.parts!.bubble!.background!)).toBeGreaterThanOrEqual(4.5);
  });

  it('drops a code block background of the opposite lightness, which would hide highlighted code', () => {
    const dark = normalizeTheme({
      palette: { background: '#101010' },
      parts: { code: { background: '#f4ecd8', border: '#333333', radius: 0.25 } },
    }, options);

    expect(dark.parts?.code).toEqual({ border: '#333333', radius: 0.25 });
  });

  it('turns tile loops on soft lights into drift, drops part background alpha, and keeps built-in scene names', () => {
    const theme = normalizeTheme({
      palette: { background: '#000000' },
      backdrop: { layers: [{ kind: 'glow', color: '#ffffff', animation: 'rise' }] },
      parts: { composer: { background: '#22222240' } },
    }, options);

    expect(typeof theme.backdrop === 'object' && theme.backdrop.layers[0]!.animation).toBe('drift');
    expect(theme.parts?.composer?.background).toBe('#222222');
    expect(normalizeTheme({ palette: { background: '#000000' }, backdrop: 'paper' }, options).backdrop).toBe('paper');
  });

  it('keeps the base backdrop when the reply asks to, built-in speeds included, and stills it when Animated is off', () => {
    const rain = { kind: 'rain' as const, color: '#ffffff', opacity: 0.9, x: 0, y: 0, size: 60, angle: 0, animation: 'fall' as const, duration: 0.7 };
    const keep = { layers: [rain, { ...rain, animation: 'twinkle' as const, duration: 1 }] };
    const reply = { palette: { background: '#000000' }, backdrop: 'keep' };

    const kept = normalizeTheme(reply, { ...options, keep }).backdrop;
    const still = normalizeTheme(reply, { ...options, keep, animated: false }).backdrop;

    expect(kept).toEqual({ layers: [rain, { ...rain, animation: 'twinkle', duration: 4 }] });
    expect(typeof still === 'object' && still.layers.map((layer) => layer.animation)).toEqual(['none', 'none']);
  });

  it('calls a background dark exactly when its text turns white', () => {
    const grey = normalizeTheme({ palette: { background: '#777777' } }, options);

    expect(grey.colorScheme).toBe(grey.palette.foreground === '#ffffff' ? 'dark' : 'light');
  });

  it('keeps links readable on every surface and caps broad light at half strength', () => {
    const theme = normalizeTheme({
      palette: { background: '#101010', raised: '#3a6df0', link: '#4a7dff' },
      backdrop: { layers: [{ kind: 'glow', color: '#ffffff', opacity: 1 }, { kind: 'stars', color: '#ffffff', opacity: 1 }] },
    }, options);

    for (const surface of ['#101010', '#3a6df0']) expect(contrast(theme.palette.link!, surface)).toBeGreaterThanOrEqual(4.5);
    expect(typeof theme.backdrop === 'object' && theme.backdrop.layers.map((layer) => layer.opacity)).toEqual([0.5, 1]);
  });

  it('never ships text that fails on a surface, part, or sky of the opposite lightness', () => {
    const theme = normalizeTheme({
      palette: { background: '#101010', foreground: '#eeeeee', mutedForeground: '#a1a1aa', raised: '#f5f5f5', popover: '#f5f5f5' },
      parts: { header: { background: '#f4f4f4' }, sidebar: { background: '#3a3a3a' } },
      backdrop: { sky: { from: '#ffffff', to: '#ffe0a0', angle: 180 }, layers: [] },
    }, options);
    const { palette, parts, backdrop } = theme;

    for (const surface of [palette.surface, palette.raised, palette.popover!]) {
      expect(contrast(palette.foreground, surface)).toBeGreaterThanOrEqual(4.5);
    }

    expect(parts?.header).toBeUndefined();
    expect(contrast(palette.mutedForeground, parts!.sidebar!.background!)).toBeGreaterThanOrEqual(4.5);

    const sky = typeof backdrop === 'object' ? backdrop.sky! : undefined;

    for (const end of [sky!.from, sky!.to]) expect(contrast(palette.foreground, end)).toBeGreaterThanOrEqual(4.5);
  });

  it('checks part text at the part’s default glass when the theme sets none', () => {
    const theme = normalizeTheme({
      palette: { background: '#000000', foreground: '#ffffff' },
      parts: { header: { background: '#303030', text: '#9a9a9a' } },
    }, options);
    const header = theme.parts!.header!;
    const seenThrough = mix(header.background!, '#000000', 1 - 0.72);

    expect(contrast(header.text!, seenThrough)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps error text readable on every surface', () => {
    const { palette } = normalizeTheme({ palette: { background: '#101010', destructive: '#5a0000' } }, options);

    expect(contrast(palette.destructive, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.destructiveForeground!, palette.destructive)).toBeGreaterThanOrEqual(4.5);
  });
});

