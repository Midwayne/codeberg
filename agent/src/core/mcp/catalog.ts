import { dirname } from 'node:path';

import { contentHash, safeSegment, type ContextStore } from '../context/store.js';

export interface McpToolListing {
  name: string;
  callable: string;
}

/** A tool as stored in the catalog: name, description, and argument schema. */
export interface CatalogTool extends McpToolListing {
  description: string;
  /** Present when a context store will receive the JSON file. */
  inputSchema?: unknown;
}

/** One server's catalog. The prompt report and the files are derived from this. */
export interface ServerCatalog {
  serverName: string;
  state: 'connected' | 'unavailable';
  detail?: string;
  tools: readonly CatalogTool[];
}

export interface McpServerReport {
  name: string;
  state: 'connected' | 'unavailable';
  tools: readonly McpToolListing[];
  detail?: string;
  /** Absolute directory of this server's catalog files, when a context store is set. */
  catalogDir?: string;
}

export interface PublishedCatalog {
  /** Config server name → absolute catalog directory. */
  dirs: Map<string, string>;
  /** Callable tool name → JSON file. */
  files: Map<string, string>;
}

/** Directory name for one server. Sanitized names that collide still hash apart. */
export function catalogFolder(serverName: string): string {
  return `${safeSegment(serverName)}-${contentHash(serverName)}`;
}

/** Prompt view of a catalog, plus the directory publish just wrote. */
export function serverReport(catalog: ServerCatalog, catalogDir?: string): McpServerReport {
  return {
    name: catalog.serverName,
    state: catalog.state,
    tools: catalog.tools.map((entry) => ({ name: entry.name, callable: entry.callable })),
    ...(catalog.detail ? { detail: catalog.detail } : {}),
    ...(catalogDir ? { catalogDir } : {}),
  };
}

/** Write every server's JSON, TOOLS.txt, and STATUS.txt. */
export async function publishMcpCatalog(
  context: ContextStore,
  entries: readonly ServerCatalog[],
): Promise<PublishedCatalog> {
  const dirs = new Map<string, string>();
  const files = new Map<string, string>();
  await Promise.all(
    entries.map(async (entry) => {
      const written = await Promise.all(
        catalogFiles(entry).map(async (file) => ({
          abs: await context.writeRel(file.rel, file.body),
          callable: file.callable,
        })),
      );
      const first = written[0]?.abs;
      if (first) dirs.set(entry.serverName, dirname(first));
      for (const file of written) {
        if (file.callable) files.set(file.callable, file.abs);
      }
    }),
  );
  return { dirs, files };
}

function catalogFiles(entry: ServerCatalog): { rel: string; body: string; callable?: string }[] {
  const folder = catalogFolder(entry.serverName);
  switch (entry.state) {
    case 'unavailable':
      return [
        {
          rel: `mcp/${folder}/STATUS.txt`,
          body: `state: unavailable\nerror: ${entry.detail ?? ''}\n`,
        },
      ];
    case 'connected':
      return [
        {
          rel: `mcp/${folder}/TOOLS.txt`,
          body: [
            'state: connected',
            ...entry.tools.map((listing) => `${listing.name}\t${listing.callable}`),
            '',
          ].join('\n'),
        },
        { rel: `mcp/${folder}/STATUS.txt`, body: 'state: connected\n' },
        ...entry.tools.flatMap((doc) =>
          doc.inputSchema === undefined
            ? []
            : [
                {
                  rel: `mcp/${folder}/${safeSegment(doc.name)}.json`,
                  body: toolDocument(entry.serverName, doc),
                  callable: doc.callable,
                },
              ],
        ),
      ];
    default: {
      const _never: never = entry.state;
      throw new Error(_never);
    }
  }
}

function toolDocument(serverName: string, doc: CatalogTool): string {
  return `${JSON.stringify(
    {
      server: serverName,
      tool: doc.name,
      callable: doc.callable,
      description: doc.description,
      inputSchema: doc.inputSchema,
    },
    null,
    2,
  )}\n`;
}
