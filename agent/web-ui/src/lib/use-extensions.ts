import { useEffect, useState } from 'react';

import { useExtensionDraft } from './use-extension-draft';

import type { Project } from './project-api';
import { ensureOk } from './http';

interface ExtensionCatalog {
  mcps: { name: string; kind: string; scope?: string }[];
  skills: { name: string; description: string; scope: string }[];
  warnings: string[];
}

type ExtensionsOptions = { project: Project; api: typeof fetch; kind: 'mcp' | 'skill' };

export function useExtensions({ project, api, kind }: ExtensionsOptions) {
  const { catalog, catalogError, setRevision } = useExtensionCatalog(api);
  const [scope, setScope] = useState('project');
  const [importing, setImporting] = useState(false);
  const title = kind === 'mcp' ? 'MCP servers' : 'Skills';
  const entries = kind === 'mcp' ? catalog?.mcps : catalog?.skills;

  const draft = useExtensionDraft({
    api,
    kind,
    scope,
    blocked: importing,
    onAdded: () => setRevision((value) => value + 1),
  });

  return {
    title,
    project,
    catalogError,
    setRevision,
    catalog,
    entries,
    scope,
    kind,
    importing,
    setScope,
    api,
    setImporting,
    ...draft,
  };
}

/** The configured extensions; bumping the revision reads them again. */
function useExtensionCatalog(api: typeof fetch) {
  const [catalog, setCatalog] = useState<ExtensionCatalog>();
  const [revision, setRevision] = useState(0);
  const [catalogError, setCatalogError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setCatalogError('');

    void api('/api/extensions', { signal: controller.signal })
      .then(async (response) => {
        await ensureOk(response);

        const next = (await response.json()) as ExtensionCatalog;
        if (!controller.signal.aborted) setCatalog(next);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setCatalogError(String(reason));
      });

    return () => controller.abort();
  }, [api, revision]);

  return { catalog, catalogError, setRevision };
}
