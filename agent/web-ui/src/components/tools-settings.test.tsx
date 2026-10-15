import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ToolsSettingsView } from './tools-settings';
import type { useToolSettings } from '../lib/use-tool-settings';

function render(overrides: Partial<ReturnType<typeof useToolSettings>> = {}) {
  return renderToStaticMarkup(<ToolsSettingsView settings={{ webSearch: false, allowed: true, provider: 'managed', status: 'disabled' }}
    busy={false} error="" refresh={async () => {}} change={async () => {}} {...overrides} />);
}

it('offers an accessible off-by-default web search switch and explains resource savings', () => {
  const html = render();

  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-label="Web search"');
  expect(html).toContain('aria-checked="false"');
  expect(html).toContain('all projects');
  expect(html).toContain('stops the local search service');
  expect(html).toContain('Direct URL fetching and code search remain available');
});

it('keeps the toggle available during background setup but disables it while saving', () => {
  const settings = { webSearch: true, allowed: true, provider: 'managed' as const, status: 'starting' as const };

  expect(render({ settings })).toContain('Setting up web search');
  expect(render({ settings })).not.toContain('disabled=""');
  expect(render({ settings, busy: true })).toContain('disabled=""');
});

it('shows actionable errors and respects the launcher master switch', () => {
  expect(render({ error: 'Could not save.' })).toContain('role="alert"');
  expect(render({ error: 'Could not save.' })).toContain('Retry');
  expect(render({ settings: { webSearch: false, allowed: false, provider: 'managed', status: 'disabled',
    message: 'Web access is disabled by CODEBERG_WEB_USE=false.' } })).toContain('disabled=""');
});
