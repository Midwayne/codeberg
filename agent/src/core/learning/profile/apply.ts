import { randomUUID } from 'node:crypto';

import { redactSecrets } from '../redact.js';
import { MAX_PROFILE_NOTES, type ProfileNote, type ProfileUpdate } from './types.js';

/** Apply a validated update; newest notes win when the profile is full. */
export function applyProfileUpdate(
  notes: ProfileNote[],
  update: ProfileUpdate,
  interactionId: string,
  now: string,
): ProfileNote[] {
  const removed = new Set(update.remove);
  const next = new Map(
    notes.filter((note) => !removed.has(note.id)).map((note) => [note.id, note]),
  );

  for (const change of update.update) {
    const note = next.get(change.id);
    if (!note) continue;

    next.set(note.id, touch(note, change, interactionId, now));
  }

  for (const addition of update.add) {
    const duplicate = [...next.values()].find(
      (note) => note.statement.toLowerCase() === addition.statement.toLowerCase(),
    );

    if (duplicate) {
      next.set(duplicate.id, touch(duplicate, addition, interactionId, now));
      continue;
    }

    const id = `profile-${randomUUID().slice(0, 8)}`;
    next.set(
      id,
      redactSecrets({
        id,
        ...addition,
        source_interactions: [interactionId],
        created_at: now,
        updated_at: now,
      }),
    );
  }

  return [...next.values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
    .slice(0, MAX_PROFILE_NOTES);
}

function touch(
  note: ProfileNote,
  change: Pick<ProfileNote, 'statement' | 'evidence'>,
  interactionId: string,
  now: string,
): ProfileNote {
  return redactSecrets({
    ...note,
    statement: change.statement,
    evidence: change.evidence,
    source_interactions: [...new Set([...note.source_interactions, interactionId])],
    updated_at: now,
  });
}
