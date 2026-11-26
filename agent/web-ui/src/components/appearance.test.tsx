import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ThemePicker } from './appearance';

describe('theme picker', () => {
  it('offers standard themes as a labeled native radio group with one selected theme', () => {
    const html = renderToStaticMarkup(<ThemePicker value="kanagawa" onChange={() => undefined} />);
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    for (const name of ['Dark', 'Light', 'Kanagawa', 'Tokyo Night', 'Catppuccin Mocha', 'Dracula', 'Nord', 'Gruvbox', 'Parchment', 'Ember', 'Rosé Pine', 'Everforest', 'Solarized Light', 'Phosphor']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(14);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="Kanagawa"[^>]*checked=""/);
  });
});
