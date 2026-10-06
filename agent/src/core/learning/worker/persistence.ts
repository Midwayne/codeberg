import { join } from 'node:path';
import { writeLearningTrace } from '../../module-log.js';
import { validatedClaims } from '../claims.js';
import { writeAtomic } from '../fs.js';
import { parseExtractionResponse } from '../knowledge-response.js';
import { interactionRevisions } from '../revision.js';
import { serializeArtifact } from '../store.js';
import { artifactRevision, buildKnowledgeArtifact, readArtifact } from './artifact.js';
import type { ExtractionContext } from './context.js';
import { recordCorrectionNote } from './correction.js';
import type { KnowledgeWorkerState } from './state.js';

export async function persistExtraction(
  state: KnowledgeWorkerState,
  context: ExtractionContext,
  response: ReturnType<typeof parseExtractionResponse>,
  claims: NonNullable<ReturnType<typeof validatedClaims>>,
  rejectedIndexes: number[],
): Promise<void> {
  const { job, final, revision } = context;

  const path = join(state.store.root, 'knowledge', response.category!, `${response.slug}.md`);
  const prior = await readArtifact(path);
  if (
    prior?.source_interactions.includes(job.interaction_id) &&
    artifactRevision(prior, job.interaction_id) === revision &&
    prior.status === 'active'
  ) {
    writeLearningTrace('extraction_skipped', {
      job_id: job.job_id,
      reason: 'artifact_already_current',
      slug: response.slug,
    });
    return;
  }

  const revisions = interactionRevisions(await state.store.events());
  const artifact = buildKnowledgeArtifact(context, response, claims, prior, revisions);

  await writeAtomic(path, serializeArtifact(artifact));
  writeLearningTrace('artifact_upserted', {
    job_id: job.job_id,
    slug: artifact.slug,
    claims: claims.length,
    model_reason: response.reason,
    source_interactions: artifact.source_interactions,
  });
  if (rejectedIndexes.length) await recordCorrectionNote(state, job, final, revision, [artifact]);

  state.onKnowledgeChanged?.();
}

export async function invalidateKnowledge(
  state: KnowledgeWorkerState,
  interactionId: string,
): Promise<void> {
  for (const artifact of await state.store.knowledgeArtifacts()) {
    if (
      !artifact.source_interactions.includes(interactionId) ||
      artifact.status === 'needs_verification'
    )
      continue;

    await writeAtomic(
      join(state.store.root, 'knowledge', artifact.category, `${artifact.slug}.md`),
      serializeArtifact({
        ...artifact,
        status: 'needs_verification',
        updated_at: new Date().toISOString(),
      }),
    );
  }
}
