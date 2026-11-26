import {
  MAX_ADD_ITEMS, MAX_ENTRY_CHARS, MAX_WORKLIST_ENTRIES, WorklistError,
  type NewEntry, type WorklistData, type WorklistEntry,
} from './types.js';

const MAX_TAGS = 8;
const MAX_TAG_CHARS = 40;
const MAX_REASON_CHARS = 500;

export interface AddResult {
  added: WorklistEntry[];
  /** Items already on the list as active entries, with the id they have. */
  duplicates: Array<{ text: string; id: string }>;
}

/**
 * Record new entries. An item whose text matches an active entry is not
 * added again: a model that forgot it recorded a fact gets the old id back.
 */
export function addEntries(data: WorklistData, items: readonly NewEntry[], by: string | undefined, now: string): AddResult {
  const cleaned = validItems(items);

  const result: AddResult = { added: [], duplicates: [] };
  for (const item of cleaned) {
    const existing = activeWithText(data, item.text);
    if (existing) {
      result.duplicates.push({ text: item.text, id: existing.id });
      continue;
    }

    if (data.entries.length >= MAX_WORKLIST_ENTRIES) {
      throw new WorklistError(`The working list is full (${MAX_WORKLIST_ENTRIES} entries). Nothing more was added after ${result.added.length} item(s).`);
    }

    const entry = newEntry(data, item, by, now);
    data.entries.push(entry);
    result.added.push(entry);
  }

  return result;
}

/**
 * Mark an entry wrong or obsolete. It stays readable with `include_retired`,
 * so the list keeps the history of what was believed and why it changed.
 * A correction is recorded as a new entry linked to the old one.
 */
export function retireEntry(
  data: WorklistData,
  input: { id: string; reason?: string; correction?: string },
  by: string | undefined,
  now: string,
): { retired: WorklistEntry; correction?: WorklistEntry } {
  const entry = data.entries.find((candidate) => candidate.id === input.id);
  if (!entry) throw new WorklistError(`No working-list entry ${input.id}. Call worklist_read to see the ids.`);
  if (entry.retired) throw new WorklistError(`Entry ${input.id} is already retired.`);

  const reason = input.reason?.trim().slice(0, MAX_REASON_CHARS);

  let correction: WorklistEntry | undefined;
  if (input.correction !== undefined) {
    const [item] = validItems([{ text: input.correction, tags: entry.tags }]);
    correction = newEntry(data, item!, by, now);
    data.entries.push(correction);
  }

  entry.retired = { at: now, ...(reason ? { reason } : {}), ...(correction ? { replacedBy: correction.id } : {}) };

  return { retired: entry, ...(correction ? { correction } : {}) };
}

function newEntry(data: WorklistData, item: NewEntry, by: string | undefined, now: string): WorklistEntry {
  const id = `w${data.next}`;
  data.next += 1;

  return { id, text: item.text, ...(item.tags?.length ? { tags: item.tags } : {}), createdAt: now, ...(by ? { by } : {}) };
}

function activeWithText(data: WorklistData, text: string): WorklistEntry | undefined {
  return data.entries.find((entry) => !entry.retired && entry.text === text);
}

function validItems(items: readonly NewEntry[]): NewEntry[] {
  if (!Array.isArray(items) || items.length === 0) throw new WorklistError('Supply at least one item to record.');
  if (items.length > MAX_ADD_ITEMS) throw new WorklistError(`Record at most ${MAX_ADD_ITEMS} items per call.`);

  return items.map((item) => {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text) throw new WorklistError('Each item needs non-empty text.');
    if (text.length > MAX_ENTRY_CHARS) {
      throw new WorklistError(`Keep each item under ${MAX_ENTRY_CHARS} characters; split long findings or cite paths instead of quoting code.`);
    }

    return { text, tags: validTags(item.tags) };
  });
}

function validTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;

  const cleaned = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase().slice(0, MAX_TAG_CHARS))
    .filter(Boolean);

  return [...new Set(cleaned)].slice(0, MAX_TAGS);
}
