import { LoadingBoundary } from './loading';
import { ExtensionForm } from './extension-form';
import { useExtensions } from '../lib/use-extensions';

import { ErrorNotice, Select } from './ui';
import { SkillImport } from './skill-import';
import { useProjectApi, type Project } from '../lib/project-api';

export type ProjectExtensionsProps = { kind: 'mcp' | 'skill' };

export function ProjectExtensions({ kind }: ProjectExtensionsProps) {
  const { project, fetch: api } = useProjectApi();
  return project ? (
    <Extensions key={`${project.id}:${kind}`} project={project} api={api} kind={kind} />
  ) : (
    <p role="status" className="text-sm text-muted-foreground">
      Select a project to manage its MCPs and skills.
    </p>
  );
}
export type ExtensionsProps = { project: Project; api: typeof fetch; kind: 'mcp' | 'skill' };

export function Extensions(props: ExtensionsProps) {
  const state = useExtensions(props);

  return <ExtensionsView {...state} />;
}

export type ExtensionsViewProps = ReturnType<typeof useExtensions>;

export function ExtensionsView(state: ExtensionsViewProps) {
  return (
    <section aria-label={state.title} className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{state.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.project.name} inherits global tools and skills. Project entries take precedence.
        </p>
      </div>
      {state.catalogError && (
        <ErrorNotice
          title={`Could not load ${state.title}`}
          detail={state.catalogError}
          onRetry={() => state.setRevision((value) => value + 1)}
        />
      )}
      <ExtensionCatalogView state={state} />
      {state.kind === 'mcp' &&
        state.catalog?.warnings.map((warning) => (
          <p key={warning} role="status" className="break-words text-xs text-muted-foreground">
            {warning}
          </p>
        ))}
      <label className="block space-y-2 text-sm">
        <span className="block">Available in</span>
        <Select
          disabled={state.busy || state.importing}
          value={state.scope}
          onChange={(event) => state.setScope(event.target.value)}
        >
          <option value="project">{state.project.name}</option>
          <option value="global">All projects</option>
        </Select>
      </label>
      {state.kind === 'skill' && (
        <SkillImport
          api={state.api}
          scope={state.scope}
          scopeLabel={state.scope === 'global' ? 'All projects' : state.project.name}
          onImported={() => state.setRevision((value) => value + 1)}
          onBusyChange={state.setImporting}
        />
      )}
      <ExtensionForm state={state} />
    </section>
  );
}

export type ExtensionCatalogViewProps = { state: Parameters<typeof ExtensionsView>[0] };

function ExtensionCatalogView({ state }: ExtensionCatalogViewProps) {
  return (
    <section aria-label={`Available ${state.title}`}>
      <h3 className="mb-2 text-sm font-medium">Available {state.title === 'Skills' ? 'skills' : 'MCP servers'}</h3>
      <LoadingBoundary loading={!state.catalog && !state.catalogError} label={`Loading ${state.title.toLowerCase()}…`} kind="list">
        {state.catalogError && !state.catalog ? (
          <p className="text-xs text-muted-foreground">Catalog unavailable.</p>
        ) : !state.entries?.length ? (
          <p className="text-xs text-muted-foreground">None available yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {state.entries.map((item) => (
              <li key={item.name} className="flex items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <p className="break-words">{item.name}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.scope ?? ('kind' in item ? item.kind : '')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </LoadingBoundary>
    </section>
  );
}
