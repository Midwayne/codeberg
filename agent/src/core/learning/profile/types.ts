/** How the user works, distilled from their own messages and feedback; separate from codebase knowledge. */
export const PROFILE_KINDS = [
  'preference',
  'workflow',
  'convention',
  'context',
  'project',
  'reference',
] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

export interface ProfileNote {
  id: string;
  kind: ProfileKind;
  /** A short, reusable statement about the user, e.g. "Prefers concise answers with file paths". */
  statement: string;
  /** Verbatim excerpt of the user's own text or feedback reason that supports the statement. */
  evidence: string;
  source_interactions: string[];
  created_at: string;
  updated_at: string;
}

export interface ProfileUpdate {
  add: Pick<ProfileNote, 'kind' | 'statement' | 'evidence'>[];
  update: Pick<ProfileNote, 'id' | 'statement' | 'evidence'>[];
  remove: string[];
}

export const MAX_PROFILE_NOTES = 40;

/** Newest notes added to each chat's system prompt; the rest stay listed in Saved memory. */
export const MAX_PROMPT_NOTES = 24;

export const MAX_STATEMENT_CHARS = 240;

export const MAX_EVIDENCE_CHARS = 240;
