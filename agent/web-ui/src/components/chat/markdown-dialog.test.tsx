import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import Markdown from './markdown';

const confirmation = vi.hoisted(() => ({
  isOpen: true,
  url: 'https://example.com/a/very/long/path?name=<script>alert(1)</script>',
  onClose: vi.fn(),
  onConfirm: vi.fn(),
}));

vi.mock('react-dom', () => ({ createPortal: vi.fn((children) => children) }));
vi.mock('streamdown', () => ({
  Streamdown: ({ linkSafety }: { linkSafety?: {
    enabled: boolean;
    renderModal: (props: typeof confirmation) => React.ReactNode;
  } }) => linkSafety?.enabled ? linkSafety.renderModal(confirmation) : null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  confirmation.isOpen = true;
  vi.stubGlobal('document', { body: {} });
});

afterEach(() => vi.unstubAllGlobals());

it('puts link confirmations outside message containment in a native modal', () => {
  const html = renderToStaticMarkup(<Markdown>[Open the page](https://example.com)</Markdown>);

  expect(createPortal).toHaveBeenCalledWith(expect.anything(), document.body);
  expect(html).toContain('<dialog');
  expect(html).toContain('aria-label="Open external link?"');
  expect(html).toContain('Copy link');
  expect(html).toContain('Open link');
  expect(html).toContain('Cancel');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(confirmation.onConfirm).not.toHaveBeenCalled();
});

it('does not mount hidden confirmations or leave a modal behind', () => {
  confirmation.isOpen = false;

  const html = renderToStaticMarkup(<Markdown>[Open the page](https://example.com)</Markdown>);

  expect(createPortal).not.toHaveBeenCalled();
  expect(html).toBe('');
});
