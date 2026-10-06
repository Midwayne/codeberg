#!/usr/bin/env node
import { DaemonClient, DaemonError, DEFAULT_DAEMON_URL } from '../core/client.js';
import { extractHybridHits } from '../core/evidence-extract.js';
import { formatScoredSource, formatSource } from '../core/format.js';
import type { SearchOptions } from '../core/types.js';

const VALUE_FLAGS = ['--daemon', '--k', '--repo', '--path-glob', '--kind', '--min-score'] as const;

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

  const options: SearchCliOptions = {
    daemonUrl: env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL,
    query: '',
    k: undefined,
    repo: undefined,
    path_glob: undefined,
    kind: undefined,
    min_score: undefined,
    hybrid: false,
    json: false,
  };

  const queryParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--hybrid') options.hybrid = true;
    else if (arg === '--json') options.json = true;
    else if (isValueFlag(arg)) applyValueFlag(options, arg, requireValue(arg, args[++i]));
    else if (arg.startsWith('--')) throw new SearchCliError(`unknown option: ${arg}`);
    else queryParts.push(arg);
  }

  options.query = queryParts.join(' ').trim();
  if (!options.query) throw new SearchCliError('query is required');

  if (!options.daemonUrl.trim()) throw new SearchCliError('--daemon requires a non-empty URL');

  return options;
}

function applyValueFlag(options: SearchCliOptions, flag: ValueFlag, raw: string): void {
  switch (flag) {
    case '--daemon':
      options.daemonUrl = raw;
      return;
    case '--k':
      options.k = parsePositiveInt(flag, raw);
      return;
    case '--repo':
      options.repo = raw;
      return;
    case '--path-glob':
      options.path_glob = raw;
      return;
    case '--kind':
      options.kind = raw;
      return;
    case '--min-score':
      options.min_score = parseScore(flag, raw);
      return;
    default: {
      const neverFlag: never = flag;
      throw new SearchCliError(`unknown flag: ${neverFlag}`);
    }
  }
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
