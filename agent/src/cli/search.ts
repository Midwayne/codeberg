#!/usr/bin/env node
import { DaemonClient, DaemonError, DEFAULT_DAEMON_URL } from '../core/client.js';
import { extractHybridHits } from '../core/evidence-extract.js';
import { formatScoredSource, formatSource } from '../core/format.js';
import type { SearchOptions } from '../core/types.js';
import type { SearchCliOptions } from './search/args.js';

export function searchUsage(program: string): string {
  return (
    `Usage: ${program} <query> [options]\n` +
    '\n' +
    'Direct semantic search against codeberg-d (no LLM).\n' +
    '\n' +
    'Options:\n' +
    '  --k <n>            max results (default 10)\n' +
    '  --repo <key>       restrict to one repo\n' +
    '  --path-glob <glob> fnmatch on chunk paths\n' +
    '  --kind <kind>      function, method, class, struct, interface, window, section\n' +
    '  --min-score <0-1>  minimum similarity score\n' +
    '  --hybrid           rerank with lexical boost (daemon hybrid_search tool)\n' +
    '  --json             print raw JSON\n' +
    `  --daemon <url>     daemon base URL (default ${DEFAULT_DAEMON_URL})\n` +
    '  -h, --help         show this help\n' +
    '\n' +
    'Env: CODEBERG_DAEMON_URL\n' +
    '\n' +
    'Examples:\n' +
    `  ${program} "how is chunking implemented?" --k 5\n` +
    `  ${program} authentication --kind function --path-glob 'daemon/*'\n` +
    `  ${program} "error handling" --hybrid --json`
  );
}

export async function runSearch(opts: SearchCliOptions): Promise<void> {
  const client = new DaemonClient(opts.daemonUrl);
  try {
    await client.waitReady(30_000);
  } catch (err) {
    if (!(err instanceof DaemonError && err.code === 'NOT_READY')) {
      throw err;
    }

    console.error('warning: daemon indexer not ready — results may be incomplete');
  }

  const searchOpts: SearchOptions = {
    k: opts.k ?? 10,
    repo: opts.repo,
    path_glob: opts.path_glob,
    kind: opts.kind,
    min_score: opts.min_score,
  };

  if (opts.hybrid) {
    await runHybridSearch(client, opts, searchOpts);
    return;
  }

  const results = await client.search(opts.query, searchOpts);
  if (opts.json) {
    console.log(JSON.stringify({ results }, null, 2));
    return;
  }

  printResults(results, formatSource);
}

async function runHybridSearch(
  client: DaemonClient,
  opts: SearchCliOptions,
  searchOpts: SearchOptions,
): Promise<void> {
  const out = await client.callTool('hybrid_search', { query: opts.query, ...searchOpts });
  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  printResults(extractHybridHits(out), (hit) => formatScoredSource(hit, hit.grep_boost));
}

function printResults<T extends { snippet?: string }>(
  results: T[],
  format: (result: T) => string,
): void {
  if (results.length === 0) {
    console.log('No results.');
    return;
  }

  for (const result of results) {
    console.log(format(result));
    if (result.snippet) console.log(result.snippet);

    console.log('');
  }
}

export type { SearchCliOptions } from './search/args.js';

export { parseSearchArgs, SearchCliError } from './search/args.js';
