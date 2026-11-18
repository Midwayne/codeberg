import { expect, it } from 'vitest';

import { parseReleases, pendingVersions, releaseNotesMarkdown } from './releases';

const changelog = `# Changelog

Intro text.

## [Unreleased]

### Added

- Not shipped yet.

## [0.1.15] - 2026-11-12

### Fixed

- Faster chats.

## [0.1.14] - 2026-11-08

### Added

- No-vector mode.

## [0.1.13] - 2026-11-01

- Older work.

[0.1.15]: https://example.com/compare
`;

it('reads released sections and skips unreleased work and link references', () => {
  const releases = parseReleases(changelog);

  expect(releases.map((release) => release.version)).toEqual(['0.1.15', '0.1.14', '0.1.13']);
  expect(releases[0]).toMatchObject({ date: '2026-11-12' });
  expect(releases[0]!.body).toContain('Faster chats.');
  expect(releases[0]!.body).not.toContain('No-vector');
  expect(releases[2]!.body).not.toContain('example.com');
});

it('lists the releases installed since the last visit, newest first', () => {
  const releases = parseReleases(changelog);

  expect(pendingVersions(releases, 'v0.1.13', 'v0.1.15')).toEqual(['0.1.15', '0.1.14']);
  expect(pendingVersions(releases, 'v0.1.15', 'v0.1.15')).toEqual([]);
});

it('ignores development builds and downgrades', () => {
  const releases = parseReleases(changelog);

  expect(pendingVersions(releases, 'v0.1.13', 'dev')).toEqual([]);
  expect(pendingVersions(releases, 'v0.1.15', 'v0.1.14')).toEqual([]);
  expect(pendingVersions(releases, null, 'v0.1.15')).toEqual(['0.1.15']);
  expect(pendingVersions(releases, 'garbage', 'v0.1.15')).toEqual(['0.1.15']);
});

it('caps a long gap to the most recent releases', () => {
  const releases = parseReleases(changelog);

  expect(pendingVersions(releases, 'v0.0.1', 'v0.1.15', 2)).toEqual(['0.1.15', '0.1.14']);
});

it('formats every release as a docs page with one heading per version', () => {
  const markdown = releaseNotesMarkdown(parseReleases(changelog));

  expect(markdown).toMatch(/^## v0\.1\.15 · 2026-11-12$/m);
  expect(markdown).toMatch(/^### Fixed$/m);
  expect(markdown).not.toContain('Unreleased');
});
