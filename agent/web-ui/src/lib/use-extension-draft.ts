import { useState } from 'react';
import { ensureOk, jsonInit } from './http';

type ExtensionDraftOptions = {
  api: typeof fetch;
  kind: 'mcp' | 'skill';
  scope: string;
  /** True while another action (a skill import) holds the form. */
  blocked: boolean;
  onAdded: () => void;
};

/** The "add an MCP server" or "write a skill" form: its fields, and saving them. */
export function useExtensionDraft({ api, kind, scope, blocked, onAdded }: ExtensionDraftOptions) {
  const [name, setName] = useState('');
  const [config, setConfig] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  async function add(): Promise<void> {
    const extension =
      kind === 'mcp'
        ? { config: JSON.parse(config) as unknown }
        : { content: skillFile(name, description, instructions) };

    await postExtension(api, { kind, scope, name, ...extension });

    setSaved(`${name} added. Available on the next chat turn.`);
    setName('');
    setConfig('');
    setDescription('');
    setInstructions('');
    onAdded();
  }

  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || blocked) return;

    setError('');
    setSaved('');
    setBusy(true);

    // Deferred so that invalid MCP JSON is reported through the same error path as a failed request.
    void Promise.resolve()
      .then(add)
      .catch((reason: unknown) => setError(String(reason)))
      .finally(() => setBusy(false));
  }

  return {
    name, setName, config, setConfig, description, setDescription, instructions, setInstructions,
    busy, error, saved, submit,
  };
}

async function postExtension(api: typeof fetch, extension: Record<string, unknown>): Promise<void> {
  const response = await api('/api/extensions', jsonInit('POST', extension));

  await ensureOk(response);
}

function skillFile(name: string, description: string, instructions: string): string {
  return `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}\n`;
}
