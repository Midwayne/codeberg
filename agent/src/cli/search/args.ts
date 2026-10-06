import { DEFAULT_DAEMON_URL } from '../../core/client.js';
import type { SearchOptions } from '../../core/types.js';

export const VALUE_FLAGS = [
  '--daemon',
  '--k',
  '--repo',
  '--path-glob',
  '--kind',
  '--min-score',
] as const;

export type ValueFlag = (typeof VALUE_FLAGS)[number];

export function isValueFlag(arg: string): arg is ValueFlag {
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

export function requireValue(flag: string, value: string | undefined): string {
  if (value == null || value.trim() === '') {
    throw new SearchCliError(`${flag} requires a value`);
  }

  return value;
}

export function parsePositiveInt(flag: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new SearchCliError(`${flag} must be a positive integer`);
  }

  return n;
}

export function parseScore(flag: string, raw: string): number {
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

export function applyValueFlag(options: SearchCliOptions, flag: ValueFlag, raw: string): void {
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
