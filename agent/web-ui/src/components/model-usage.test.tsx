import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UsageView } from './model-usage';
import type { UsageReport } from '@agent/core/usage';

const totals = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  costUsd: 0, unpricedRequests: 0, unreportedRequests: 0 };
const report: UsageReport = { totals, kinds: { chat: totals, learning: totals }, records: [], daily: [], models: [], start: '2026-10-01',
  end: '2026-10-08', page: 1, pageSize: 25 };
const props = { range: { start: report.start, end: report.end }, preset: 'mtd', onRange: () => undefined,
  onPreset: () => undefined, onPage: () => undefined, onExport: () => undefined, exporting: false,
  kind: 'all' as const, onKind: () => undefined };

describe('Usage view', () => {
  it('shows input and output metrics with the date and export controls', () => {
    const html = renderToStaticMarkup(<UsageView {...props} report={report} />);

    expect(html).toContain('All projects');
    expect(html).toContain('Input tokens');
    expect(html).toContain('Output tokens');
    expect(html).not.toContain('Total tokens');
    expect(html).not.toContain('Estimated spend');
    expect(html).toContain('Export CSV');
    expect(html).toContain('Last month');
    expect(html).toContain('No usage recorded');
    expect(html).toContain('Tracking starts');
    expect(html).not.toContain('Included');
  });

  it('keeps existing metrics visible and announces a pending refresh', () => {
    const html = renderToStaticMarkup(<UsageView {...props} report={report} loading />);

    expect(html).toContain('Updating usage…');
    expect(html).toContain('Input tokens');
    expect(html).toContain('Output tokens');
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('inert=""');
  });

  it('separates chat and learning input/output contributions in the combined view', () => {
    const html = renderToStaticMarkup(<UsageView {...props} report={{ ...report,
      totals: { ...totals, requests: 2, inputTokens: 300, outputTokens: 50 },
      kinds: {
        chat: { ...totals, requests: 1, inputTokens: 100, outputTokens: 20 },
        learning: { ...totals, requests: 1, inputTokens: 200, outputTokens: 30 },
      },
    }} />);

    expect(html).toContain('aria-label="Usage activity"');
    expect(html).toContain('aria-label="Input tokens by activity"');
    expect(html).toContain('aria-label="Output tokens by activity"');
    expect(html).toMatch(/Chat<\/dt><dd[^>]*>100<\/dd>/);
    expect(html).toMatch(/Learning<\/dt><dd[^>]*>200<\/dd>/);
    expect(html).toMatch(/Chat<\/dt><dd[^>]*>20<\/dd>/);
    expect(html).toMatch(/Learning<\/dt><dd[^>]*>30<\/dd>/);
  });

  it('names the selected activity and its empty state', () => {
    const html = renderToStaticMarkup(<UsageView {...props} kind="learning" report={report} />);

    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Learning<\/button>/);
    expect(html).toContain('No learning usage recorded for this period');
    expect(html).not.toContain('tokens by activity');
  });

  it('marks missing token reporting without requiring model prices', () => {
    const html = renderToStaticMarkup(<UsageView {...props} report={{ ...report,
      totals: { ...totals, requests: 1, unpricedRequests: 1, unreportedRequests: 1 },
      records: [{ id: '1', timestamp: Date.UTC(2026, 9, 1), model: 'custom:model', key: 'custom:variant',
        projectName: 'Alpha', kind: 'learning', inputTokens: null, outputTokens: null,
        cacheReadTokens: null, cacheWriteTokens: null, costUsd: null }],
    }} />);

    expect(html).not.toContain('Unpriced');
    expect(html).not.toContain('models.yml');
    expect(html).toContain('incomplete token reporting');
    expect(html).toContain('Not reported');
    expect(html).toContain('Alpha');
    expect(html).toContain('Learning');
  });

  it('shows reported input and output across charts and desktop/mobile history without cache or spend', () => {
    const activity = { ...totals, requests: 1, inputTokens: 1234, outputTokens: 567,
      cacheReadTokens: 900, cacheWriteTokens: 100, costUsd: 0.5 };
    const html = renderToStaticMarkup(<UsageView {...props} report={{ ...report,
      totals: activity,
      daily: [{ ...activity, date: report.start }],
      models: [{ ...activity, model: 'custom:model' }],
      records: [{ id: '1', timestamp: Date.UTC(2026, 9, 1), model: 'custom:model', key: 'custom:variant',
        projectName: 'Alpha', kind: 'chat', inputTokens: 1234, outputTokens: 567,
        cacheReadTokens: 900, cacheWriteTokens: 100, costUsd: 0.5 }],
    }} />);

    expect(html).toContain('1.2K input');
    expect(html).toContain('567 output');
    expect(html).toContain('Daily input tokens chart');
    expect(html).toContain('>Input tokens</th>');
    expect(html).toContain('>Output tokens</th>');
    expect(html).not.toMatch(/cache|estimated|unpriced|spend|USD|\$/i);
  });
});
