import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { writeAtomic } from '../../fs.js';
import { writeLearningTrace } from '../../module-log.js';
import { sourceRevision } from '../datasets.js';
import { capturesKnowledge } from '../knowledge-feedback.js';
import { sourceCommits } from '../memory-source.js';
import { interactionRevisions } from '../revision.js';
import { effectiveFeedback, parseArtifact, serializeArtifact, stableId } from '../store.js';
import type { AttemptRecord, FeedbackRecord, KnowledgeArtifact, KnowledgeJob } from '../types.js';
import { artifactLineage, artifactRevision } from '../worker/artifact.js';
import { retireConfirmedAnswer } from '../worker/confirmed.js';
import type { KnowledgeWorkerState } from '../worker/state.js';
import { PROCEDURE_SYSTEM, procedurePrompt, recordedCalls, teachingAttempts } from './prompt.js';
import { procedureBody } from './render.js';
import { parseProcedure, type Procedure } from './response.js';

/**
 * Learn a taught workflow (tool calls, queries, steps) from a confirmed answer and the
 * conversation that led to it. Procedures need no source quote: each step reuses a
 * recorded tool call or the user's own words.
 */
export async function learnProcedure(
  state: KnowledgeWorkerState,
  job: KnowledgeJob,
): Promise<void> {
  if (job.source_refresh || !state.generator || !state.settings().categories.procedures) return;

  const interaction = await state.store.interaction(job.interaction_id);
  const final = interaction.attempts.at(-1);
  if (!final) return;

  const feedback = effectiveFeedback(await state.store.events()).get(final.attempt_id);
  if (!capturesKnowledge(feedback?.label)) return;

  const revision = sourceRevision(interaction.attempts, interaction.feedback);
  const existing = (await state.store.knowledgeArtifacts()).filter(
    (artifact) => artifact.category === 'procedures' && artifact.status !== 'archived',
  );
  if (alreadyLearned(existing, job.interaction_id, revision)) return;

  const conversation = (await state.store.attempts()).filter(
    (attempt) => attempt.conversation_id === final.conversation_id,
  );
  const attempts = teachingAttempts(conversation, final);
  const calls = recordedCalls(attempts);

  // A single question answered without tools teaches no procedure; skip the model call.
  if (!calls.length && attempts.length < 2) return;

  const raw = await state.generator.generate({
    system: PROCEDURE_SYSTEM,
    traceId: job.job_id,
    prompt: procedurePrompt({ attempts, calls, feedback, existing }),
  });

  const userText = [...attempts.map((attempt) => attempt.user_query), feedback?.reason ?? ''];
  const procedure = parseProcedure(raw, calls, userText);
  if (!procedure) {
    writeLearningTrace('procedure_skipped', { job_id: job.job_id, raw });
    return;
  }

  await saveProcedure(state, { job, final, revision, feedback, procedure });
}

function alreadyLearned(
  existing: KnowledgeArtifact[],
  interactionId: string,
  revision: string,
): boolean {
  return existing.some(
    (artifact) =>
      artifact.status === 'active' &&
      artifact.source_interactions.includes(interactionId) &&
      artifactRevision(artifact, interactionId) === revision,
  );
}

async function saveProcedure(
  state: KnowledgeWorkerState,
  input: {
    job: KnowledgeJob;
    final: AttemptRecord;
    revision: string;
    feedback?: FeedbackRecord;
    procedure: Procedure;
  },
): Promise<void> {
  const { job, final, revision, feedback, procedure } = input;
  const path = join(state.store.root, 'knowledge', 'procedures', `${procedure.slug}.md`);
  const prior = await readFile(path, 'utf8').then(parseArtifact, () => undefined);
  const revisions = interactionRevisions(await state.store.events());
  const now = new Date().toISOString();
  const repositories = await state.store.repositories();

  const artifact: KnowledgeArtifact = {
    id: prior?.id ?? stableId('procedure', procedure.slug),
    title: procedure.title,
    category: 'procedures',
    slug: procedure.slug,
    created_at: prior?.created_at ?? now,
    updated_at: now,
    last_verified_at: now,
    repositories: [...new Set(final.repositories.map((repo) => basename(repo.path)))],
    ...artifactLineage(prior, job.interaction_id, revision, revisions),
    source_commits: sourceCommits(repositories),
    source_refs: [],
    claims: [],
    confidence: feedback?.label === 'solved' ? 'high' : 'medium',
    status: 'active',
    body: procedureBody(procedure),
  };

  await writeAtomic(path, serializeArtifact(artifact));
  // The procedure records the taught workflow better than the raw answer did.
  await retireConfirmedAnswer(state, job.interaction_id);
  writeLearningTrace('procedure_saved', {
    job_id: job.job_id,
    slug: procedure.slug,
    steps: procedure.steps.length,
  });
  state.onKnowledgeChanged?.();
}
