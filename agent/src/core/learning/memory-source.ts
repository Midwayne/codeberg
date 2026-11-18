import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  readSource,
  sourceKey,
  type SourceObservation,
  type SourceRef,
} from './memory-source/reading.js';

import { isConfirmedAnswer } from './confirmed-answer.js';
import type { KnowledgeArtifact, RepositoryVersion } from './types.js';

export { evidenceRefs } from './memory-source/evidence.js';

/** Follow repository-relative citations, never an arbitrary path from model output. */
export async function observeSources(
  refs: SourceRef[],
  repositories: RepositoryVersion[],
  cache?: Map<string, Promise<SourceObservation>>,
): Promise<SourceObservation[]> {
  return Promise.all(
    refs.map((ref) => {
      const key = `${sourceKey(ref)}\0${ref.symbol ?? ''}`;
      let observation = cache?.get(key);
      if (!observation) {
        observation = readSource(ref, repositories);
        cache?.set(key, observation);
      }

      return observation;
    }),
  );
}

export function sourceHashes(observations: SourceObservation[]): Record<string, string> {
  return Object.fromEntries(
    observations.filter((item) => item.hash).map((item) => [sourceKey(item), item.hash!]),
  );
}

export function sourceCommits(repositories: RepositoryVersion[]): Record<string, string> {
  return Object.fromEntries(
    repositories.filter((repo) => repo.commit).map((repo) => [basename(repo.path), repo.commit!]),
  );
}

/** The fingerprint changes on a commit, working-tree edit, deletion, or repo loss. */
export async function memorySourceState(
  artifact: KnowledgeArtifact,
  repositories: RepositoryVersion[],
  cache?: Map<string, Promise<SourceObservation>>,
): Promise<{
  fresh: boolean;
  revision: string;
  observations: SourceObservation[];
  hashes: Record<string, string>;
}> {
  const relevant = repositories.filter(
    (repo) =>
      artifact.repositories.includes(basename(repo.path)) ||
      artifact.source_refs?.some((ref) => ref.repo === repo.path),
  );

  const observations = await observeSources(artifact.source_refs ?? [], repositories, cache);
  const hashes = sourceHashes(observations);
  const version = artifact.repositories.map((name) => {
    const repo = relevant.find((entry) => basename(entry.path) === name);

    return [name, repo?.path, repo?.commit ?? null];
  });

  const revision = `code-${createHash('sha256')
    .update(
      JSON.stringify([
        version,
        observations.map((item) => [item.repo, item.path, item.hash ?? item.unavailable]),
      ]),
    )
    .digest('hex')
    .slice(0, 24)}`;

  const commitsCurrent =
    artifact.repositories.length > 0 &&
    artifact.repositories.every((name) =>
      repositoryCurrent(name, artifact, relevant, observations),
    );

  const filesCurrent = observations.every(
    (item) => item.hash && item.hash === artifact.source_hashes?.[sourceKey(item)],
  );
  const fresh =
    filesCurrent && (observations.length > 0 || commitsCurrent || filelessAnswer(artifact));

  return { fresh, revision, observations, hashes };
}

/**
 * Unchanged cited files keep a finding current across unrelated commits. A finding with
 * no readable citations falls back to the repository commit, except a confirmed answer
 * that consulted no files: only a rating change can make it stale.
 */
function filelessAnswer(artifact: KnowledgeArtifact): boolean {
  return isConfirmedAnswer(artifact) && !artifact.source_refs?.length;
}

function repositoryCurrent(
  name: string,
  artifact: KnowledgeArtifact,
  repositories: RepositoryVersion[],
  observations: SourceObservation[],
): boolean {
  const repo = repositories.find((entry) => basename(entry.path) === name);
  if (!repo) return false;

  if (repo.commit) return repo.commit === artifact.source_commits[name];

  return (
    !artifact.source_commits[name] &&
    observations.some((item) => item.repo === repo.path && item.hash)
  );
}

export type { SourceObservation, SourceRef } from './memory-source/reading.js';

export { sourceKey, sourceTextFor } from './memory-source/reading.js';

export { relocatedSources } from './memory-source/relocation.js';
