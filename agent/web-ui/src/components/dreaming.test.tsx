import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { DreamingReport } from '@/lib/dreaming';
import { DreamingReportList, DreamingReportView } from './dreaming';

const report: DreamingReport = { schema_version: 1, id: 'dream-test', created_at: '2026-10-06T00:00:00Z', summary: 'Inventory findings',
  considered: 2, omitted: 1, changes: [], status: 'proposed', decisions: [] };
it('shows an honest empty report and disables applying it', () => {
  const html = renderToStaticMarkup(<DreamingReportView report={report} enabled busy={false} onDecision={() => {}} />);
  expect(html).toContain('No changes proposed');
  expect(html).toContain('outside this pass');
  expect(html).toMatch(/disabled=""[^>]*>Apply report/);
});
it('keeps undo visible for applied reports and locks changes while paused', () => {
  const html = renderToStaticMarkup(<DreamingReportView report={{ ...report, status: 'applied' }} enabled={false} busy={false} onDecision={() => {}} />);
  expect(html).toMatch(/disabled=""[^>]*>Undo report/);
  expect(html).toContain('Undo keeps any newer findings');
});
it('escapes untrusted report copy and names each selectable report', () => {
  const html = renderToStaticMarkup(<DreamingReportList dashboard={{ reports: [{ ...report, changes: [], summary: '<script>evil()</script>' }], jobs: [], canGenerate: true }} busy={false} onSelect={() => {}} />);
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('Recent consolidation reports');
});
