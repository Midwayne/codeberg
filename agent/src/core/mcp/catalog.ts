import { dirname } from 'node:path';

import type { ContextStore } from '../context/store.js';
import { safeSegment } from '../context/store.js';

export interface McpToolListing {
  name: string;
  callable: string;
}

export interface CatalogDoc {
  toolName: string;
  callable: string;
  json: string;
}

/** One server's on-disk catalog. `serverName` is the config name, not the folder. */
export interface ServerCatalog {
  serverName: string;
  folder: string;
  state: 'connected' | 'unavailable';
  detail?: string;
  listings: readonly McpToolListing[];
  docs: readonly CatalogDoc[];
}

export interface PublishedCatalog {
  /** Config server name → absolute catalog directory. */
  dirs: Map<string, string>;
  /** Callable tool name → JSON file. */
  files: Map<string, string>;
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
  switch (entry.state) {
    case 'unavailable':
      return [
        {
          rel: `mcp/${entry.folder}/STATUS.txt`,
          body: `state: unavailable\nerror: ${entry.detail ?? ''}\n`,
        },
      ];
    case 'connected':
      return [
        {
          rel: `mcp/${entry.folder}/TOOLS.txt`,
          body: [
            'state: connected',
            ...entry.listings.map((listing) => `${listing.name}\t${listing.callable}`),
            '',
          ].join('\n'),
        },
        { rel: `mcp/${entry.folder}/STATUS.txt`, body: 'state: connected\n' },
        ...entry.docs.map((doc) => ({
          rel: `mcp/${entry.folder}/${safeSegment(doc.toolName)}.json`,
          body: doc.json,
          callable: doc.callable,
        })),
      ];
    default: {
      const _never: never = entry.state;
      throw new Error(_never);
    }
  }
}
