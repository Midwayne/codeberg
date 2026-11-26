import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BackdropToggle, ThemePicker } from './appearance';

describe('theme picker', () => {
  it('offers standard themes as a labeled native radio group with one selected theme', () => {
    const html = renderToStaticMarkup(<ThemePicker value="kanagawa" onChange={() => undefined} />);
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    for (const name of ['Dark', 'Light', 'Kanagawa', 'Tokyo Night', 'Catppuccin Mocha', 'Dracula', 'Nord', 'Gruvbox', 'Parchment', 'Ember', 'Rosé Pine', 'Everforest', 'Solarized Light', 'Phosphor', 'Midnight', 'Aurora']) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(16);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="Kanagawa"[^>]*checked=""/);
  });

  it('previews a scene only on themes that have a backdrop', () => {
    const html = renderToStaticMarkup(<ThemePicker value="dark" onChange={() => undefined} />);

    expect(html.match(/class="backdrop-preview"/g)).toHaveLength(5);
    expect(html).toContain('data-scene="night-sky"');
  });

  it('shows the backdrop switch on by default', () => {
    const html = renderToStaticMarkup(<BackdropToggle theme="midnight" />);

    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
  });
});
