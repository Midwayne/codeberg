/** Most entries one chat's working list keeps, retired ones included. */
export const MAX_WORKLIST_ENTRIES = 500;

/** Longest text of one entry, in characters. */
export const MAX_ENTRY_CHARS = 2_000;

/** Most entries one `worklist_add` call can record. */
export const MAX_ADD_ITEMS = 20;

export interface WorklistEntry {
  /** Short, stable id (`w1`, `w2`, …) the model cites and retires by. */
  id: string;
  text: string;
  tags?: string[];
  createdAt: string;
  /** The subagent that recorded it; absent for the main agent. */
  by?: string;
  /** Set when the entry turned out wrong or no longer applies. It stays readable. */
  retired?: { at: string; reason?: string; replacedBy?: string };
}

export interface WorklistData {
  version: 1;
  next: number;
  entries: WorklistEntry[];
}

export interface NewEntry {
  text: string;
  tags?: string[];
}

export class WorklistError extends Error {}

export function emptyWorklist(): WorklistData {
  return { version: 1, next: 1, entries: [] };
}
