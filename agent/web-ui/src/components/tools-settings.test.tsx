import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ToolsSettingsView } from './tools-settings';
import type { useToolSettings } from '../lib/use-tool-settings';

function render(overrides: Partial<ReturnType<typeof useToolSettings>> = {}) {
  return renderToStaticMarkup(<ToolsSettingsView settings={{ browserUse: false, browserVision: false, webSearch: false, allowed: true, provider: 'managed', status: 'disabled' }}
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
  const settings = { browserUse: false, browserVision: false, webSearch: true, allowed: true, provider: 'managed' as const, status: 'starting' as const };

  expect(render({ settings })).toContain('Setting up web search');
  expect(render({ settings })).not.toContain('disabled=""');
  expect(render({ settings, busy: true })).toContain('disabled=""');
});

it('shows actionable errors and respects the launcher master switch', () => {
  expect(render({ error: 'Could not save.' })).toContain('role="alert"');
  expect(render({ error: 'Could not save.' })).toContain('Retry');
  expect(render({ settings: { browserUse: false, browserVision: false, webSearch: false, allowed: false, provider: 'managed', status: 'disabled',
    message: 'Web access is disabled by CODEBERG_WEB_USE=false.' } })).toContain('disabled=""');
});

it('explains on-demand delegation, setup, and cancellation without requiring a model', () => {
  const html = render();

  expect(html).toContain('aria-label="Browser Use"');
  expect(html).toContain('separate local agent');
  expect(html).toContain('only when the agent delegates a task');
  expect(html).toContain('Requires uv');
  expect(html).toContain('/docs/tools#browser-use-delegation');
  expect(html).toContain('cancels active browser tasks');
});

it('explains explicit retention, follow-ups, and closing retained browsers', () => {
  const html = render();

  expect(html).toContain('leave the browser open');
  expect(html).toContain('continue in it later');
  expect(html).toContain('retained browsers');
  expect(html).toContain('New sessions');
});

it('keeps both switches usable when search control is unavailable without claiming the worker stopped', () => {
  const html = render({ settings: { browserUse: true, browserVision: false, webSearch: false, allowed: true,
    provider: 'managed', status: 'error', message: 'Search control unavailable. Restart Codeberg and retry.' } });

  expect(html).toContain('aria-label="Web search"');
  expect(html).toContain('aria-label="Browser Use"');
  expect(html).not.toContain('disabled=""');
  expect(html).toContain('Search control unavailable');
  expect(html).not.toContain('The local search service is stopped.');
});

it('offers an off-by-default screenshot toggle and explains the model eligibility requirement', () => {
  const html = render();

  expect(html).toMatch(/aria-label="Browser vision"[^>]*aria-checked="false"/);
  expect(html).toContain('vision input support in models.yml');
  expect(html).toContain('even when screenshots are off');
  expect(html).toContain('next browser task');
});
