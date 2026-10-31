import type { ReactNode } from 'react';

import { buttonClass } from '../components/button-styles';
import { configLines, type SetupRequired } from './status';

export type SetupChecklistProps = {
  status: SetupRequired;
  checking: boolean;
  stillMissing: boolean;
  onCheck: () => void;
};

/** Guided first-run steps shown above the docs until a chat model is usable. */
export function SetupChecklist({ status, checking, stillMissing, onCheck }: SetupChecklistProps) {
  return (
    <section aria-labelledby="setup-title" className="mb-12 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 id="setup-title" className="text-xl font-semibold">Finish setting up Codeberg</h2>
      <p className="mt-2 leading-7 text-muted-foreground">
        Chat needs a model you can use. Until one is configured, Codeberg shows only these docs.
      </p>
      <SetupReasonDetail status={status} />
      <ol className="mt-5 list-decimal space-y-4 pl-5 leading-7">
        <li>In a terminal, run <code>codeberg config edit</code> to open your Codeberg config.</li>
        {status.reason !== 'invalid-config' && (
          <li>Add these lines with your values, then save the file.<SetupLines status={status} /></li>
        )}
        <li>Stop Codeberg with <kbd>Ctrl-C</kbd> in its terminal, then run <code>codeberg</code> again.</li>
        <li>
          <button type="button" className={buttonClass} disabled={checking} onClick={onCheck}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
          {stillMissing && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              Still not configured. Codeberg reads these settings when it starts, so restart it after saving.
            </p>
          )}
        </li>
      </ol>
      <p className="mt-5 text-sm">
        More help: <a href="/docs/getting-started#connect-a-model">Connect a model</a> · <a href="/docs/models">Models</a>
      </p>
    </section>
  );
}

function SetupReasonDetail({ status }: { status: SetupRequired }) {
  switch (status.reason) {
    case 'missing-credentials':
      return <p className="mt-4 leading-7">{credentialsSummary(status)}</p>;
    case 'no-model':
      return <p className="mt-4 leading-7">No chat model is configured yet. Choose a provider and model.</p>;
    case 'invalid-config':
      return (
        <div className="mt-4 leading-7">
          <p>Codeberg could not read the model configuration:</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-sm">{status.detail}</pre>
          <p className="mt-2">Fix <code>models.yml</code> or <code>CODEBERG_MODEL</code>; the Models guide lists the format.</p>
        </div>
      );
    default:
      return status.reason satisfies never;
  }
}

function credentialsSummary(status: SetupRequired): string {
  const labels = status.providers.map((provider) => provider.label);

  if (labels.length === 1) return `Your model catalog uses ${labels[0]}, but its credentials are not set.`;

  return `Your model catalog uses ${labels.join(' or ')}, but none of their credentials are set. Configure at least one.`;
}

function SetupLines({ status }: { status: SetupRequired }) {
  if (status.reason === 'no-model') {
    return <ConfigBlock>{'CODEBERG_MODEL=openai:gpt-4o\nOPENAI_API_KEY='}</ConfigBlock>;
  }

  return (
    <>
      {status.providers.map((provider) => (
        <div key={provider.provider} className="mt-3">
          <h3 className="text-sm font-semibold">{provider.label}</h3>
          <ConfigBlock>{configLines(provider)}</ConfigBlock>
        </div>
      ))}
    </>
  );
}

function ConfigBlock({ children }: { children: ReactNode }) {
  return <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-sm"><code>{children}</code></pre>;
}
