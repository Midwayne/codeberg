import type { KnowledgeArtifact } from './types.js';

export function withUserNotes(body: string, notes?: KnowledgeArtifact['user_confirmed_notes']): string {
  const base = body.split('\n## User-confirmed notes (not source-verified)\n')[0].trim();
  if (!notes?.length) return base;
  return `${base}\n\n## User-confirmed notes (not source-verified)\n` +
    notes.map((note) => `- ${note.text} (user-confirmed, ${note.confirmed_at})`).join('\n');
}
