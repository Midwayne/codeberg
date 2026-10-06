import { Plus } from 'lucide-react';

import { type ExtensionsView } from './extensions';

export const control =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export const button = 'min-h-11 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50';

export type ExtensionFormProps = { state: Parameters<typeof ExtensionsView>[0] };

export function ExtensionForm({ state }: ExtensionFormProps) {
  return (
    <form className="space-y-4 border-t border-border pt-5" onSubmit={createExtensionSubmit({ state })}>
      <h3 className="text-sm font-medium">{state.kind === 'mcp' ? 'Add an MCP server' : 'Write a skill'}</h3>
      <ExtensionFields state={state} />
      {state.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.saved && (
        <p role="status" className="text-sm">
          {state.saved}
        </p>
      )}
      <button
        type="submit"
        disabled={state.busy || state.importing}
        className={`${button} inline-flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90`}
      >
        <Plus className="size-4" />
        {state.busy ? 'Adding…' : state.kind === 'mcp' ? 'Add MCP server' : 'Add skill'}
      </button>
    </form>
  );
}

export type ExtensionFieldsProps = Pick<Parameters<typeof ExtensionForm>[0], 'state'>;

export function ExtensionFields({ state }: ExtensionFieldsProps) {
  return (
    <fieldset disabled={state.busy || state.importing} className="space-y-4">
      <label className="block space-y-2 text-sm">
        <span>Name</span>
        <input
          required
          pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}"
          value={state.name}
          onChange={(event) => state.setName(event.target.value)}
          className={control}
        />
      </label>
      <ExtensionContentFields state={state} />
    </fieldset>
  );
}

export type ExtensionContentFieldsProps = Pick<Parameters<typeof ExtensionFields>[0], 'state'>;

export function ExtensionContentFields({ state }: ExtensionContentFieldsProps) {
  return state.kind === 'mcp' ? (
    <label className="block space-y-2 text-sm">
      <span>Server configuration (JSON)</span>
      <textarea
        required
        rows={5}
        value={state.config}
        onChange={(event) => state.setConfig(event.target.value)}
        placeholder={
          '{"url": "https://your-server.example/mcp"}\nOr use {"command": "…", "args": []} for a local server.'
        }
        className={`${control} resize-y font-mono`}
      />
      <span className="block text-xs leading-5 text-muted-foreground">
        Supports command, args, env, URL and headers. Use environment references for credentials.
      </span>
    </label>
  ) : (
    <>
      <label className="block space-y-2 text-sm">
        <span>Description</span>
        <input
          required
          value={state.description}
          onChange={(event) => state.setDescription(event.target.value)}
          className={control}
        />
      </label>
      <label className="block space-y-2 text-sm">
        <span>Instructions</span>
        <textarea
          required
          rows={5}
          value={state.instructions}
          onChange={(event) => state.setInstructions(event.target.value)}
          className={`${control} resize-y`}
        />
      </label>
    </>
  );
}

export type ExtensionSubmitOptions = Pick<Parameters<typeof ExtensionForm>[0], 'state'>;

function createExtensionSubmit({ state }: ExtensionSubmitOptions) {
  return (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.busy || state.importing) return;
    state.setError('');
    state.setSaved('');
    state.setBusy(true);
    void Promise.resolve()
      .then(async () => {
        const body =
          state.kind === 'mcp'
            ? {
                kind: state.kind,
                scope: state.scope,
                name: state.name,
                config: JSON.parse(state.config) as unknown,
              }
            : {
                kind: state.kind,
                scope: state.scope,
                name: state.name,
                content: `---\nname: ${JSON.stringify(state.name)}\ndescription: ${JSON.stringify(state.description)}\n---\n\n${state.instructions}\n`,
              };
        const response = await state.api('/api/extensions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await response.text());
        state.setSaved(`${state.name} added. Available on the next chat turn.`);
        state.setName('');
        state.setConfig('');
        state.setDescription('');
        state.setInstructions('');
        state.setRevision((value) => value + 1);
      })
      .catch((reason: unknown) => state.setError(String(reason)))
      .finally(() => state.setBusy(false));
  };
}
