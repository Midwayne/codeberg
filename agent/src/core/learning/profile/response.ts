import { isRecord } from '../../record.js';
import { invalidResponse } from '../failure.js';
import {
  MAX_EVIDENCE_CHARS,
  MAX_STATEMENT_CHARS,
  PROFILE_KINDS,
  type ProfileKind,
  type ProfileUpdate,
} from './types.js';

const MAX_ADDITIONS = 5;
const IDENTIFIER = /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d/;

/** Lenient parse: invalid entries are dropped so one bad note never discards the rest. */
export function parseProfileUpdate(raw: string, userText: string[]): ProfileUpdate {
  const value = parseObject(raw);
  const grounded = groundedIn(userText);

  const add = list(value.add)
    .flatMap((entry) => {
      const note = noteFields(entry, grounded);
      const kind = entry.kind as ProfileKind;

      return note && PROFILE_KINDS.includes(kind) ? [{ kind, ...note }] : [];
    })
    .slice(0, MAX_ADDITIONS);

  const update = list(value.update).flatMap((entry) => {
    const note = noteFields(entry, grounded);

    return note && typeof entry.id === 'string' ? [{ id: entry.id, ...note }] : [];
  });

  const remove = (Array.isArray(value.remove) ? value.remove : []).filter(
    (id): id is string => typeof id === 'string',
  );

  return { add, update, remove };
}

function parseObject(raw: string): Record<string, unknown> {
  const text = raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  try {
    const value: unknown = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
    if (isRecord(value)) return value;
  } catch {
    // Reported below as an unusable response.
  }

  throw invalidResponse('malformed profile update');
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function noteFields(
  entry: Record<string, unknown>,
  grounded: (evidence: string) => boolean,
): { statement: string; evidence: string } | undefined {
  const statement = typeof entry.statement === 'string' ? entry.statement.trim() : '';
  const evidence = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';

  if (!statement || statement.length > MAX_STATEMENT_CHARS) return undefined;

  if (evidence.length < 4 || evidence.length > MAX_EVIDENCE_CHARS || !grounded(evidence))
    return undefined;

  if (IDENTIFIER.test(statement) || IDENTIFIER.test(evidence)) return undefined;

  return { statement, evidence };
}

/** Whitespace- and case-insensitive substring match against the user's own words. */
function groundedIn(userText: string[]): (evidence: string) => boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = userText.map(normalize);

  return (evidence) => {
    const needle = normalize(evidence).replace(/^["'“”]+|["'“”.…]+$/g, '');

    return needle.length >= 4 && haystack.some((text) => text.includes(needle));
  };
}
