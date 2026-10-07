import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SuccessNotice } from './success-notice';

describe('success announcements', () => {
  it('reserves wrapping space without announcing an operation before it completes', () => {
    const html = renderToStaticMarkup(<SuccessNotice message="" sizingText="2 skills imported." />);

    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<p role="status"[^>]*>(.*?)<\/p>/)?.[1]).toBe('');
  });

  it('announces the completed result in a single live region', () => {
    const html = renderToStaticMarkup(<SuccessNotice message="2 skills imported." sizingText="20 skills imported." />);

    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.match(/<p role="status"[^>]*>(.*?)<\/p>/)?.[1]).toBe('2 skills imported.');
  });
});
