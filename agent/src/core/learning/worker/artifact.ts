import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { withUserNotes } from '../artifact-body.js';
import { knowledgeBody, validatedClaims } from '../claims.js';
import { parseExtractionResponse } from '../knowledge-response.js';
import { sourceCommits, sourceHashes } from '../memory-source.js';
import { redactSecrets } from '../redact.js';
import { stableId } from '../store.js';
import type { KnowledgeArtifact } from '../types.js';
import type { ExtractionContext } from './context.js';

export function artifactLineage(
  prior: KnowledgeArtifact | undefined,
  interactionId: string,
  revision: string,
  revisions: Map<string, string>,
) {
  const verifiedPrior = (prior?.status === 'active' ? prior.source_interactions : []).filter(
    (id) => revisions.has(id) && artifactRevision(prior!, id) === revisions.get(id),
  );
  const historical = [
    ...new Set([
      ...(prior?.historical_source_interactions ?? []),
      ...(prior?.source_interactions ?? []).filter((id) => !verifiedPrior.includes(id)),
    ]),
  ].filter((id) => id !== interactionId);

  return {
    source_interactions: [...new Set([...verifiedPrior, interactionId])],
    historical_source_interactions: historical,
    source_revision: revision,
    source_revisions: {
      ...Object.fromEntries(verifiedPrior.map((id) => [id, artifactRevision(prior!, id)!])),
      [interactionId]: revision,
    },
  };
}

export function buildKnowledgeArtifact(
  context: ExtractionContext,
  response: ReturnType<typeof parseExtractionResponse>,
  claims: NonNullable<ReturnType<typeof validatedClaims>>,
  prior: KnowledgeArtifact | undefined,
  revisions: Map<string, string>,
): KnowledgeArtifact {
  const { job, revision, observations, currentRepositories } = context;

  const now = new Date().toISOString();
  const lineage = artifactLineage(prior, job.interaction_id, revision, revisions);

  const cited = new Set(
    claims.flatMap((claim) => claim.evidence.map((item) => `${item.repo}\0${item.path}`)),
  );
  const freshObservations = observations.filter(
    (item) => item.hash && cited.has(`${basename(item.repo)}\0${item.path}`),
  );
  const repositories = [...new Set(freshObservations.map((item) => basename(item.repo)))];

  return {
    id: prior?.id ?? stableId('knowledge', response.category!, response.slug!),
    title: redactSecrets(response.title!),
    category: response.category!,
    slug: response.slug!,
    created_at: prior?.created_at ?? now,
    updated_at: now,
    last_verified_at: now,
    repositories,
    ...lineage,
    source_commits: sourceCommits(currentRepositories),
    source_refs: freshObservations.map(({ repo, path, symbol }) => ({
      repo,
      path,
      ...(symbol ? { symbol } : {}),
    })),
    source_hashes: sourceHashes(freshObservations),
    claims,
    user_confirmed_notes: prior?.user_confirmed_notes,
    confidence: response.confidence!,
    status: response.status!,
    body: withUserNotes(knowledgeBody(claims), prior?.user_confirmed_notes),
  };
}

export function artifactRevision(
  artifact: KnowledgeArtifact,
  interactionId: string,
): string | undefined {
  return (
    artifact.source_revisions?.[interactionId] ??
    (artifact.source_interactions.length === 1 ? artifact.source_revision : undefined)
  );
}

export async function readArtifact(path: string): Promise<KnowledgeArtifact | undefined> {
  try {
    const { parseArtifact } = await import('../store.js');

    return parseArtifact(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}
