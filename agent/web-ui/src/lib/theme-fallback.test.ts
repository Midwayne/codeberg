/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { THEMES, type Palette } from './theme-palettes';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe.each(THEMES.filter(({ id }) => id === 'dark' || id === 'light'))('$label neutrals', (theme) => {
  it('matches the CSS fallback before JavaScript loads', () => {
    const selector = theme.id === 'dark' ? '.dark' : ':root';
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0]!;
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value]));
    const palette: Palette = theme.palette;

    expect(tokens['background']).toBe(palette.background);
    expect(tokens['foreground']).toBe(palette.foreground);
    expect(tokens['card']).toBe(palette.surface);
    expect(tokens['popover']).toBe(palette.popover);
    expect(tokens['muted-foreground']).toBe(palette.mutedForeground);
    expect(tokens['primary']).toBe(palette.primary);
    expect(tokens['border']).toBe(palette.border);
    expect(tokens['input']).toBe(palette.input);
    expect(tokens['ring']).toBe(palette.ring);
  });

  it('keeps softened text, actions and keyboard focus readable', () => {
    const palette: Palette = theme.palette;
    const surfaces = [palette.background, palette.surface, palette.raised, palette.popover!];

    for (const surface of surfaces) {
      expect(contrast(palette.foreground, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.mutedForeground, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.ring!, surface)).toBeGreaterThanOrEqual(3);
    }

    expect(contrast(palette.primary, palette.primaryForeground!)).toBeGreaterThanOrEqual(4.5);
  });
});
