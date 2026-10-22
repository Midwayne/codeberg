import { renderToStaticMarkup } from 'react-dom/server';
import { createPortal } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { CitationTooltip, citationTooltipPosition } from './citation-tooltip';

vi.mock('react-dom', () => ({ createPortal: vi.fn((children) => children) }));

afterEach(() => vi.unstubAllGlobals());

it('renders outside the paint-contained message so its source cannot be clipped', () => {
  const body = {};
  vi.stubGlobal('document', { body });

  const html = renderToStaticMarkup(
    <CitationTooltip anchor={{ current: null }} id="citation-source">
      src/services/shipments/repository.ts:120-150 — click to copy
    </CitationTooltip>,
  );

  expect(createPortal).toHaveBeenCalledWith(expect.anything(), body);
  expect(html).toContain('role="tooltip"');
  expect(html).toContain('id="citation-source"');
  expect(html).toContain('fixed');
  expect(html).toContain('src/services/shipments/repository.ts:120-150');
});

it('keeps a long source inside the right viewport edge', () => {
  const position = citationTooltipPosition(
    { left: 750, top: 250, bottom: 266 }, { width: 320, height: 60 },
    { width: 800, height: 600 },
  );

  expect(position).toEqual({ left: 472, top: 184 });
});

it('places the source below citations near the top edge', () => {
  const position = citationTooltipPosition(
    { left: 2, top: 10, bottom: 26 }, { width: 280, height: 60 },
    { width: 390, height: 600 },
  );

  expect(position).toEqual({ left: 8, top: 32 });
});

it('clamps tall sources to the available viewport height', () => {
  const position = citationTooltipPosition(
    { left: 200, top: 90, bottom: 106 }, { width: 300, height: 180 },
    { width: 390, height: 200 },
  );

  expect(position).toEqual({ left: 82, top: 12 });
});
