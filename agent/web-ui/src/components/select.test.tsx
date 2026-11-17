import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { Select } from './ui';

it('renders a styled dropdown hook with a soft focus state instead of the outline ring', () => {
  const html = renderToStaticMarkup(
    <Select aria-label="Model" defaultValue="b">
      <option value="a">Alpha</option>
      <option value="b">Beta</option>
    </Select>,
  );

  expect(html).toMatch(/<select[^>]*class="[^"]*\bui-select\b/);
  expect(html).toContain('ui-select-icon');
  expect(html).toContain('<option value="b" selected="">Beta</option>');
});
