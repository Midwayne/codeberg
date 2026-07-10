#!/usr/bin/env node
import { DaemonClient, DaemonError, DEFAULT_DAEMON_URL } from '../core/client.js';
import { extractHybridHits } from '../core/evidence-extract.js';
import { formatScoredSource, formatSource } from '../core/format.js';
import type { SearchOptions } from '../core/types.js';

const VALUE_FLAGS = [
  '--daemon',
  '--k',
  '--repo',
  '--path-glob',
  '--kind',
  '--min-score',
] as const;

type ValueFlag = (typeof VALUE_FLAGS)[number];

function isValueFlag(arg: string): arg is ValueFlag {
  return (VALUE_FLAGS as readonly string[]).includes(arg);
}

export class SearchCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchCliError';
  }
}

export interface SearchCliOptions extends SearchOptions {
  daemonUrl: string;
  query: string;
  hybrid?: boolean;
  json?: boolean;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value == null || value.trim() === '') {
    throw new SearchCliError(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new SearchCliError(`${flag} must be a positive integer`);
  }
  return n;
}

function parseScore(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new SearchCliError(`${flag} must be a number between 0 and 1`);
  }
  return n;
}

export function parseSearchArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): SearchCliOptions | 'help' {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    return 'help';
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
    if (arg === '--hybrid') {
      hybrid = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (isValueFlag(arg)) {
      const raw = requireValue(arg, args[++i]);
      switch (arg) {
        case '--daemon':
          daemonUrl = raw;
          break;
        case '--k':
          k = parsePositiveInt(arg, raw);
          break;
        case '--repo':
          repo = raw;
          break;
        case '--path-glob':
          path_glob = raw;
          break;
        case '--kind':
          kind = raw;
          break;
        case '--min-score':
          min_score = parseScore(arg, raw);
          break;
        default: {
          const _never: never = arg;
          throw new SearchCliError(`unknown flag: ${_never}`);
        }
      }
      continue;
    }
    if (arg.startsWith('--')) {
      throw new SearchCliError(`unknown option: ${arg}`);
    }
    queryParts.push(arg);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    throw new SearchCliError('query is required');
  }
  if (!daemonUrl.trim()) {
    throw new SearchCliError('--daemon requires a non-empty URL');
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

  const hybridArgs = {
    query: opts.query,
    ...searchOpts,
  };

  if (opts.hybrid) {
    const out = await client.callTool('hybrid_search', hybridArgs);
    if (opts.json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    const hits = extractHybridHits(out);
    if (hits.length === 0) {
      console.log('No results.');
      return;
    }
    for (const hit of hits) {
      console.log(formatScoredSource(hit, hit.grep_boost));
      if (hit.snippet) {
        console.log(hit.snippet);
      }
      console.log('');
    }
    return;
  }

  if (opts.json) {
    const results = await client.search(opts.query, searchOpts);
    console.log(JSON.stringify({ results }, null, 2));
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
