import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LoadingBoundary, LoadingStatus } from './loading';

describe('loading surfaces', () => {
  it('announces loading and prevents interaction with unfinished content', () => {
    const html = renderToStaticMarkup(
      <LoadingBoundary loading label="Loading models…" kind="form">
        <button>Save settings</button>
      </LoadingBoundary>,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/inert=""[^>]*aria-hidden="true"/);
    expect(html).toContain('Loading models…');
  });

  it('keeps the scaffold for stable geometry and removes its announcement when ready', () => {
    const html = renderToStaticMarkup(
      <LoadingBoundary loading={false} label="Loading models…" kind="form">
        <button>Save settings</button>
      </LoadingBoundary>,
    );

    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('inert=""');
    expect(html).toContain('Save settings');
    expect(html).toContain('aria-hidden="true"');
  });

  it('allows a resolved lazy screen to focus its heading during the loading fade', () => {
    const html = renderToStaticMarkup(
      <LoadingBoundary loading contentReady label="Loading settings…">
        <h1 tabIndex={-1}>Settings</h1>
      </LoadingBoundary>,
    );

    expect(html).not.toContain('inert=""');
    expect(html).toContain('data-ready="true"');
    expect(html).toContain('role="status"');
  });

  it('does not announce a refresh after it completes', () => {
    const html = renderToStaticMarkup(<LoadingStatus active={false} label="Refreshing usage…" />);

    expect(html).not.toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
  });
});
