import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import type { SetupRequired } from '@agent/core/setup-types.js';
import { DocsPage } from '../docs/page';
import { SetupChecklist } from './checklist';

const missing: SetupRequired = {
  ready: false,
  reason: 'missing-credentials',
  detail: 'models.yml must define at least one model',
  providers: [
    { provider: 'openai', label: 'OpenAI', missing: ['OPENAI_API_KEY'] },
    { provider: 'anthropic', label: 'Anthropic', missing: ['ANTHROPIC_API_KEY'] },
  ],
};

function render(status: SetupRequired, stillMissing = false) {
  return renderToStaticMarkup(
    <SetupChecklist status={status} checking={false} stillMissing={stillMissing} onCheck={() => undefined} />,
  );
}

it('lists the missing credentials with the steps to add them', () => {
  const html = render(missing);

  expect(html).toContain('Finish setting up Codeberg');
  expect(html).toContain('OpenAI');
  expect(html).toContain('OPENAI_API_KEY=');
  expect(html).toContain('ANTHROPIC_API_KEY=');
  expect(html).toContain('codeberg config edit');
  expect(html).toContain('Ctrl-C');
  expect(html).toContain('Check again');
  expect(html).toContain('href="/docs/getting-started#connect-a-model"');
  expect(html).toContain('none of their credentials are set. Configure at least one.');
});

it('describes a single provider without asking to choose one', () => {
  const html = render({ ...missing, providers: [missing.providers[0]!] });

  expect(html).toContain('Your model catalog uses OpenAI, but its credentials are not set.');
  expect(html).not.toContain('at least one');
});

it('asks for a model when none is configured', () => {
  const html = render({ ready: false, reason: 'no-model', detail: '', providers: [] });

  expect(html).toContain('No chat model is configured');
  expect(html).toContain('CODEBERG_MODEL=');
  expect(html).toContain('href="/docs/models"');
});

it('shows the configuration error without credential lines', () => {
  const html = render({ ready: false, reason: 'invalid-config', detail: 'invalid models.yml: bad indent', providers: [] });

  expect(html).toContain('invalid models.yml: bad indent');
  expect(html).not.toContain('Add these lines');
});

it('explains that a restart is needed when a check finds nothing new', () => {
  expect(render(missing, true)).toContain('Still not configured');
});

it('shows the checklist above the docs and hides the way back to the app', () => {
  const html = renderToStaticMarkup(
    <DocsPage path="/docs/getting-started" setup={<p>setup checklist</p>} />,
  );

  expect(html).toContain('setup checklist');
  expect(html).toContain('Getting started');
  expect(html).not.toContain('Back to app');
  expect(renderToStaticMarkup(<DocsPage path="/docs/getting-started" />)).toContain('Back to app');
});
