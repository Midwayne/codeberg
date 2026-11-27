import type { CodeFont, ThemeFont } from './theme-types';

/* System font stacks only: themes never download fonts, so they work offline. */
export const FONT_STACKS: Record<ThemeFont, string> = {
  sans: 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  serif: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, Cambria, serif',
  mono: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT", Nunito, Quicksand, ui-sans-serif, system-ui, sans-serif',
  slab: 'Rockwell, "Roboto Slab", "Zilla Slab", "Bitstream Charter", "Courier New", Georgia, serif',
};

export const CODE_STACKS: Record<CodeFont, string> = {
  mono: FONT_STACKS.mono,
  typewriter: '"Courier Prime", "American Typewriter", "Courier New", Courier, ui-monospace, monospace',
  narrow: 'Iosevka, "Iosevka Term", "PragmataPro", "Roboto Mono", "Ubuntu Mono", ui-monospace, monospace',
};
