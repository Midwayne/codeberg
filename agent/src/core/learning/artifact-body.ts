import type { KnowledgeArtifact } from './types.js';

const USER_NOTES_HEADING = '\n## User-confirmed notes (not source-verified)\n';

export function stripUserNotes(body: string): string {
  return body.split(USER_NOTES_HEADING)[0].trim();
}

export function withUserNotes(
  body: string,
  notes?: KnowledgeArtifact['user_confirmed_notes'],
): string {
  const base = stripUserNotes(body);
  if (!notes?.length) return base;

  return (
    `${base}\n${USER_NOTES_HEADING}` +
    notes.map((note) => `- ${note.text} (user-confirmed, ${note.confirmed_at})`).join('\n')
  );
}
