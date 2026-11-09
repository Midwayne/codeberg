import { expect, it } from 'vitest';

import { projectDaemonUrl } from './daemon-url.js';

it('scopes the daemon URL to the active project once', () => {
  expect(projectDaemonUrl('http://127.0.0.1:8080/', 'p1')).toBe('http://127.0.0.1:8080/projects/p1');
  expect(projectDaemonUrl('http://127.0.0.1:8080/projects/p1', 'p1')).toBe('http://127.0.0.1:8080/projects/p1');
});

it('leaves the URL unscoped without a project', () => {
  expect(projectDaemonUrl('http://127.0.0.1:8080', undefined)).toBe('http://127.0.0.1:8080');
});
