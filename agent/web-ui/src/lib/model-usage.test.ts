import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportUsage, loadUsage, usageRange, usageQuery } from './model-usage';

afterEach(() => vi.unstubAllGlobals());

describe('usage ranges', () => {
  it('uses UTC calendar days for presets, including month and year boundaries', () => {
    const now = new Date('2026-01-01T23:50:00-05:00');

    expect(usageRange('1d', now)).toEqual({ start: '2026-01-02', end: '2026-01-03' });
    expect(usageRange('7d', now)).toEqual({ start: '2025-12-27', end: '2026-01-03' });
    expect(usageRange('mtd', now)).toEqual({ start: '2026-01-01', end: '2026-01-03' });
    expect(usageRange('last-month', now)).toEqual({ start: '2025-12-01', end: '2026-01-01' });
    expect(usageQuery(usageRange('7d', now), 2)).toContain('page=2');
  });

  it('includes the activity filter in report and export queries', async () => {
    const range = { start: '2026-10-01', end: '2026-10-03' };
    const api = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ records: [] }) });
    const signal = new AbortController().signal;

    await loadUsage(range, 2, api, signal, 'learning');

    expect(api).toHaveBeenCalledWith('/api/settings/usage?start=2026-10-01&end=2026-10-03&page=2&kind=learning',
      { cache: 'no-store', signal });
    expect(usageQuery(range, 1, 'chat')).toContain('kind=chat');
    expect(usageQuery(range, 1, 'all')).toContain('kind=all');
  });

  it('exports the selected activity with a distinct filename', async () => {
    const range = { start: '2026-10-01', end: '2026-10-03' };
    const api = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['csv']) });
    const link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link });

    await exportUsage(range, api, 'learning');

    expect(api).toHaveBeenCalledWith('/api/settings/usage?start=2026-10-01&end=2026-10-03&page=1&kind=learning&format=csv',
      { cache: 'no-store' });
    expect(link.download).toBe('codeberg-usage-learning-2026-10-01.csv');
    expect(link.click).toHaveBeenCalledOnce();
  });
});
