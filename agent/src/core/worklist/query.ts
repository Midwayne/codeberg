import { exceedsRegexGroupDepth } from '../context/grep-regex.js';
import { matchWithin } from './regex.js';
import { MAX_WORKLIST_ENTRIES, WorklistError, type WorklistData, type WorklistEntry } from './types.js';

export const DEFAULT_READ_LIMIT = 100;
export const MAX_PATTERN_CHARS = 500;

export interface ReadInput {
  pattern?: string;
  regex?: boolean;
  tag?: string;
  include_retired?: boolean;
  limit?: number;
}

export interface ReadResult {
  entries: WorklistEntry[];
  /** Entries that matched before `limit` was applied. */
  matched: number;
  active: number;
  retired: number;
  note?: string;
}

/**
 * Filter the list like grep over entry text and tags: a case-insensitive
 * substring by default, or a JavaScript regular expression. Entries keep the
 * order they were recorded in; past `limit`, the most recent ones are kept.
 */
export function queryWorklist(data: WorklistData, input: ReadInput = {}): ReadResult {
  const matches = matcher(input);
  const tag = input.tag?.trim().toLowerCase();
  const limit = readLimit(input.limit);

  const candidates = data.entries.filter((entry) =>
    (input.include_retired === true || !entry.retired) &&
    (!tag || entry.tags?.includes(tag) === true));
  const hits = matches(candidates.map(searchable));
  const matched = candidates.filter((_, index) => hits[index]);

  const retired = data.entries.filter((entry) => entry.retired).length;
  const entries = matched.slice(-limit);

  return {
    entries,
    matched: matched.length,
    active: data.entries.length - retired,
    retired,
    ...(entries.length < matched.length ? { note: `Showing the ${entries.length} most recent of ${matched.length} matches; narrow with pattern or tag, or raise limit.` } : {}),
  };
}

/* Whether each text matches the pattern; a regular expression runs under a time limit. */
function matcher(input: ReadInput): (texts: string[]) => boolean[] {
  const pattern = input.pattern ?? '';
  if (!pattern) return (texts) => texts.map(() => true);
  if (pattern.length > MAX_PATTERN_CHARS) throw new WorklistError(`Keep pattern under ${MAX_PATTERN_CHARS} characters.`);

  if (input.regex !== true) {
    const needle = pattern.toLowerCase();

    return (texts) => texts.map((text) => text.toLowerCase().includes(needle));
  }

  if (exceedsRegexGroupDepth(pattern)) throw new WorklistError('The regular expression nests too many groups.');

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch (error) {
    throw new WorklistError(`Invalid regular expression: ${(error as Error).message}`);
  }

  return (texts) => matchWithin(regex, texts);
}

function searchable(entry: WorklistEntry): string {
  return entry.tags?.length ? `${entry.text}\n${entry.tags.join(' ')}` : entry.text;
}

function readLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_READ_LIMIT;

  return Math.min(Math.max(Math.trunc(value), 1), MAX_WORKLIST_ENTRIES);
}
