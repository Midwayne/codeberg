import type { ExtensionCatalog } from '@agent/core/api/extensions.js';
import { responseJson } from './response.js';
import type { ProjectInfo } from '@agent/core/api/projects.js';
import { useEffect, useState } from 'react';

export type ExtensionsOptions = { project: ProjectInfo; api: typeof fetch; kind: 'mcp' | 'skill' };

export function useExtensions({ project, api, kind }: ExtensionsOptions) {
  const [catalog, setCatalog] = useState<ExtensionCatalog>();
  const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState('');
  const [scope, setScope] = useState('project');
  const [importing, setImporting] = useState(false);
  const title = kind === 'mcp' ? 'MCP servers' : 'Skills';
  const entries = kind === 'mcp' ? catalog?.mcps : catalog?.skills;
  const [name, setName] = useState('');
  const [config, setConfig] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  useExtensionCatalog({ setCatalogError, api, setCatalog, revision });

  return {
    title,
    project,
    name,
    catalogError,
    setRevision,
    catalog,
    entries,
    scope,
    kind,
    busy,
    importing,
    setScope,
    api,
    setImporting,
    setError,
    setSaved,
    setBusy,
    config,
    description,
    instructions,
    setName,
    setConfig,
    setDescription,
    setInstructions,
    error,
    saved,
  };
}

export type ExtensionCatalogOptions = Pick<Parameters<typeof useExtensions>[0], 'api'> & {
  setCatalogError: React.Dispatch<React.SetStateAction<string>>;
  setCatalog: React.Dispatch<React.SetStateAction<ExtensionCatalog | undefined>>;
  revision: number;
};

export function useExtensionCatalog({ setCatalogError, api, setCatalog, revision }: ExtensionCatalogOptions) {
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError('');
    void api('/api/extensions', { signal: controller.signal })
      .then(async (response) => {
        const next = await responseJson<ExtensionCatalog>(response);
        if (!controller.signal.aborted) setCatalog(next);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setCatalogError(String(reason));
      });
    return () => controller.abort();
  }, [api, revision]);
}
