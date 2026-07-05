#!/usr/bin/env node
import { DaemonClient, DaemonError } from '../core/client.js';
import { formatSource } from '../core/format.js';
import type { SearchOptions } from '../core/types.js';

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:8080';

export interface SearchCliOptions extends SearchOptions {
  daemonUrl: string;
  query: string;
  hybrid?: boolean;
  json?: boolean;
}

export function parseSearchArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): SearchCliOptions | null {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return null;
  }

  let daemonUrl = env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL;
  let k: number | undefined;
  let repo: string | undefined;
  let path_glob: string | undefined;
  let kind: string | undefined;
  let min_score: number | undefined;
  let hybrid = false;
  let json = false;
  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--daemon':
        daemonUrl = args[++i] ?? '';
        break;
      case '--k':
        k = Number(args[++i]);
        break;
      case '--repo':
        repo = args[++i];
        break;
      case '--path-glob':
        path_glob = args[++i];
        break;
      case '--kind':
        kind = args[++i];
        break;
      case '--min-score':
        min_score = Number(args[++i]);
        break;
      case '--hybrid':
        hybrid = true;
        break;
      case '--json':
        json = true;
        break;
      default:
        queryParts.push(arg);
    }
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    return null;
  }

  return { daemonUrl, query, k, repo, path_glob, kind, min_score, hybrid, json };
}

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
    '  --kind <kind>      function, method, class, struct, interface, window\n' +
    '  --min-score <0-1>  minimum similarity score\n' +
    '  --hybrid           rerank with lexical boost (daemon hybrid_search tool)\n' +
    '  --json             print raw JSON\n' +
    '  --daemon <url>     daemon base URL (default http://127.0.0.1:8080)\n' +
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

  if (opts.json) {
    if (opts.hybrid) {
      const out = await client.callTool('hybrid_search', {
        query: opts.query,
        ...searchOpts,
      });
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    const results = await client.search(opts.query, searchOpts);
    console.log(JSON.stringify({ results }, null, 2));
    return;
  }

  if (opts.hybrid) {
    const out = (await client.callTool('hybrid_search', {
      query: opts.query,
      ...searchOpts,
    })) as Array<{ hit: Record<string, unknown>; grep_boost: number; final_score: number }>;
    if (!Array.isArray(out) || out.length === 0) {
      console.log('No results.');
      return;
    }
    for (const row of out) {
      const h = row.hit;
      const repo = typeof h.repo === 'string' && h.repo ? `[${h.repo}] ` : '';
      const sym = typeof h.symbol === 'string' && h.symbol ? ` ${h.symbol}` : '';
      const lines = `${h.start_line}-${h.end_line}`;
      console.log(
        `${repo}${h.path}:${lines}${sym}  score=${Number(row.final_score).toFixed(3)} boost=${row.grep_boost}`,
      );
      if (typeof h.snippet === 'string' && h.snippet) {
        console.log(h.snippet);
      }
      console.log('');
    }
    return;
  }

  const results = await client.search(opts.query, searchOpts);
  if (results.length === 0) {
    console.log('No results.');
    return;
  }
  for (const r of results) {
    console.log(formatSource(r));
    if (r.snippet) {
      console.log(r.snippet);
    }
    console.log('');
  }
}
