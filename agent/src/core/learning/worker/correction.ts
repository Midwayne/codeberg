import { join } from 'node:path';
import { writeLearningTrace } from '../../module-log.js';
import { withUserNotes } from '../artifact-body.js';
import { writeAtomic } from '../fs.js';
import { redactSecrets } from '../redact.js';
import { serializeArtifact } from '../store.js';
import type { AttemptRecord, KnowledgeArtifact, KnowledgeJob } from '../types.js';
import type { KnowledgeWorkerState } from './state.js';

export async function recordCorrectionNote(
  state: KnowledgeWorkerState,
  job: KnowledgeJob,
  final: AttemptRecord,
  revision: string,
  existing: KnowledgeArtifact[],
): Promise<void> {
  const text = final.user_query.trim().replace(/\s+/g, ' ').slice(0, 1_000);
  if (
    !/^(?:i meant\b|actually\b|no\b|to clarify\b|please (?:add|remember|note|update)\b|(?:add|remember|note|update)\b|remember that\b)/i.test(
      text,
    )
  ) {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'no_explicit_user_correction',
    });
    return;
  }

  const words = new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const match = existing.find(
    (artifact) =>
      [...new Set(artifact.title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((word) =>
        words.has(word),
      ).length >= 2,
  );

  if (!match) {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'no_matching_artifact_for_correction',
    });
    return;
  }

  const redacted = redactSecrets(text);
  if (
    match.user_confirmed_notes?.some(
      (note) => note.interaction_id === job.interaction_id && note.text === redacted,
    )
  )
    return;

  await saveCorrectionNote(state, match, job, revision, redacted);
}

export async function saveCorrectionNote(
  state: KnowledgeWorkerState,
  match: KnowledgeArtifact,
  job: KnowledgeJob,
  revision: string,
  redacted: string,
): Promise<void> {
  const note = {
    interaction_id: job.interaction_id,
    source_revision: revision,
    text: redacted,
    confirmed_at: new Date().toISOString(),
    provenance: 'user_confirmed' as const,
  };

  const notes = [...(match.user_confirmed_notes ?? []), note];
  await writeAtomic(
    join(state.store.root, 'knowledge', match.category, `${match.slug}.md`),
    serializeArtifact({
      ...match,
      user_confirmed_notes: notes,
      status: 'needs_verification',
      updated_at: note.confirmed_at,
      body: withUserNotes(match.body, notes),
    }),
  );
  writeLearningTrace('user_note_added', {
    job_id: job.job_id,
    slug: match.slug,
    note: note.text,
  });
  state.onKnowledgeChanged?.();
}
