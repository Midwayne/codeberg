import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UsageView } from './model-usage';
import type { UsageReport } from '@agent/core/usage';

const totals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  costUsd: 0, unpricedRequests: 0, unreportedRequests: 0 };
const report: UsageReport = { totals, records: [], daily: [], models: [], start: '2026-10-01',
  end: '2026-10-08', page: 1, pageSize: 25 };
const props = { range: { start: report.start, end: report.end }, preset: 'mtd', onRange: () => undefined,
  onPreset: () => undefined, onPage: () => undefined, onExport: () => undefined, exporting: false };

describe('Usage view', () => {
  it('shows an honest first-use state and the full set of reference controls', () => {
    const html = renderToStaticMarkup(<UsageView {...props} report={report} />);

    expect(html).toContain('All projects');
    expect(html).toContain('Estimated spend');
    expect(html).toContain('Total tokens');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Last month');
    expect(html).toContain('No usage recorded');
    expect(html).toContain('Tracking starts');
    expect(html).not.toContain('Included');
  });

  it('marks missing prices and token reporting instead of presenting them as free usage', () => {
    const html = renderToStaticMarkup(<UsageView {...props} report={{ ...report,
      totals: { ...totals, requests: 1, unpricedRequests: 1, unreportedRequests: 1 },
      records: [{ id: '1', timestamp: Date.UTC(2026, 9, 1), model: 'custom:model', key: 'custom:variant',
        projectName: 'Alpha', kind: 'learning', inputTokens: null, outputTokens: null,
        cacheReadTokens: null, cacheWriteTokens: null, costUsd: null }],
    }} />);

    expect(html).toContain('Unavailable');
    expect(html).toContain('Unpriced');
    expect(html).toContain('Not reported');
    expect(html).toContain('Alpha');
    expect(html).toContain('Learning');
    expect(html).toContain('models.yml');
  });
});
