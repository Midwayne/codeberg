import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { findDocPage } from '../docs/catalog';
import { WhatsNewDialog } from './dialog';
import { bundledReleases } from './changelog';
import type { Release } from './releases';

const releases: Release[] = [
  { version: '0.1.15', date: '2026-11-12', body: '### Fixed\n\n- Faster chats.' },
  { version: '0.1.14', date: '2026-11-08', body: '### Added\n\n- No-vector mode.' },
];

function render(since: string | null) {
  return renderToStaticMarkup(
    <WhatsNewDialog since={since} version="v0.1.15" releases={releases} onClose={() => undefined} />,
  );
}

it('opens with the newest release expanded and older ones collapsed', () => {
  const html = render('v0.1.13');

  expect(html).toContain('What&#x27;s new in Codeberg');
  expect(html).toContain('the last 2 releases');
  const details = [...html.matchAll(/<details([^>]*)>/g)].map((match) => match[1]);

  expect(details).toHaveLength(2);
  expect(details[0]).toContain('open');
  expect(details[1]).not.toContain('open');
  expect(html.indexOf("0.1.15")).toBeLessThan(html.indexOf("0.1.14"));
  expect(html).toContain('Faster chats.');
  expect(html).toContain('No-vector mode.');
  expect(html).toContain('href="/docs/whats-new"');
  expect(html).toContain('Got it');
});

it('shows only the current release to someone seeing the feature for the first time', () => {
  const html = render(null);

  expect(html).toContain('Faster chats.');
  expect(html).not.toContain('No-vector mode.');
});

it('renders nothing when the installed version has no notes', () => {
  expect(renderToStaticMarkup(
    <WhatsNewDialog since={null} version="v9.9.9" releases={releases} onClose={() => undefined} />,
  )).toBe('');
});

it('bundles the repository changelog into the docs', () => {
  const page = findDocPage('/docs/whats-new')!;

  expect(bundledReleases.length).toBeGreaterThan(0);
  expect(page.content).toContain(`## v${bundledReleases[0]!.version}`);
  expect(page.content).not.toContain('Unreleased');
});
