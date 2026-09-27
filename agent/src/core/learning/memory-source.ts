import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';

import type { AttemptRecord, KnowledgeArtifact, RepositoryVersion } from './types.js';

export type SourceRef = NonNullable<KnowledgeArtifact['source_refs']>[number];
export interface SourceObservation extends SourceRef {
  commit?: string;
  hash?: string;
  excerpt?: string;
  excerpt_start_line?: number;
  truncated?: boolean;
  unavailable?: string;
}

export function sourceKey(ref: SourceRef): string { return `${ref.repo}\0${ref.path}`; }

/** Follow repository-relative citations, never an arbitrary path from model output. */
export function evidenceRefs(attempt: AttemptRecord): SourceRef[] {
  const repositories = attempt.repositories;
  const byKey = new Map<string, SourceRef>();
  for (const hit of attempt.evidence_used) {
    if (!hit.path) continue;
    const repo = repositories.find((entry) => entry.path === hit.repo || basename(entry.path) === hit.repo) ??
      (repositories.length === 1 ? repositories[0] : undefined);
    if (!repo) continue;
    const ref = { repo: repo.path, path: hit.path, ...(hit.symbol ? { symbol: hit.symbol } : {}) };
    byKey.set(sourceKey(ref), ref);
    if (byKey.size >= 12) break;
  }
  return [...byKey.values()];
}

export async function observeSources(
  refs: SourceRef[], repositories: RepositoryVersion[], cache?: Map<string, Promise<SourceObservation>>,
): Promise<SourceObservation[]> {
  return Promise.all(refs.map((ref) => {
    const key = `${sourceKey(ref)}\0${ref.symbol ?? ''}`;
    let observation = cache?.get(key);
    if (!observation) {
      observation = readSource(ref, repositories);
      cache?.set(key, observation);
    }
    return observation;
  }));
}

async function readSource(ref: SourceRef, repositories: RepositoryVersion[]): Promise<SourceObservation> {
    const repo = repositories.find((entry) => entry.path === ref.repo);
    if (!repo) return { ...ref, unavailable: 'repository not available' };
    try {
      const root = await realpath(repo.path);
      const path = resolve(root, ref.path);
      const location = relative(root, path);
      if (!location || location === '..' || location.startsWith(`..${sep}`) || resolve(path) !== path) {
        throw new Error('invalid repository-relative path');
      }
      const actual = await realpath(path);
      if (!actual.startsWith(`${root}${sep}`)) throw new Error('source is outside the repository');
      if ((await stat(actual)).size > 1_000_000) throw new Error('source file exceeds safe read limit');
      const content = await readFile(actual);
      const text = content.toString('utf8');
      const hash = createHash('sha256').update(content).digest('hex');
      const needle = ref.symbol?.split(/[.#:]/).at(-1);
      const position = needle ? Math.max(0, text.indexOf(needle) - 1_500) : 0;
      const excerpt = text.slice(position, position + 12_000);
      const excerpt_start_line = 1 + (text.slice(0, position).match(/\n/g)?.length ?? 0);
      return { ...ref, commit: repo.commit, hash, excerpt, excerpt_start_line, truncated: excerpt.length < text.length };
    } catch (error) {
      return { ...ref, commit: repo.commit, unavailable: String(error) };
    }
}

/** Bounded local symbol lookup when a cited file moved; results remain unverified until opened. */
export async function relocatedSources(ref: SourceRef, repositories: RepositoryVersion[]): Promise<SourceRef[]> {
  const repo = repositories.find((entry) => entry.path === ref.repo);
  const symbol = ref.symbol?.split(/[.#:]/).at(-1);
  if (!repo || !symbol || symbol.length < 3) return [];
  const root = await realpath(repo.path).catch(() => undefined);
  if (!root) return [];
  const dirs = [root];
  const matches: SourceRef[] = [];
  let inspected = 0;
  while (dirs.length && inspected < 2_000 && matches.length < 5) {
    const dir = dirs.shift()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (inspected >= 2_000 || matches.length >= 5) break;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !['node_modules', 'vendor', 'dist', 'build', 'third_party'].includes(entry.name)) {
          dirs.push(resolve(dir, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      inspected++;
      const path = resolve(dir, entry.name);
      if (relative(root, path) === ref.path) continue;
      try {
        if ((await stat(path)).size > 1_000_000) continue;
        const text = await readFile(path, 'utf8');
        if (text.includes('\0') || !text.includes(symbol)) continue;
        matches.push({ repo: repo.path, path: relative(root, path), symbol: ref.symbol });
      } catch { /* Files may move while scanning; keep looking. */ }
    }
  }
  return matches;
}

export function sourceHashes(observations: SourceObservation[]): Record<string, string> {
  return Object.fromEntries(observations.filter((item) => item.hash).map((item) => [sourceKey(item), item.hash!]));
}

export function sourceCommits(repositories: RepositoryVersion[]): Record<string, string> {
  return Object.fromEntries(repositories.filter((repo) => repo.commit).map((repo) => [basename(repo.path), repo.commit!]));
}

/** The fingerprint changes on a commit, working-tree edit, deletion, or repo loss. */
export async function memorySourceState(artifact: KnowledgeArtifact, repositories: RepositoryVersion[], cache?: Map<string, Promise<SourceObservation>>): Promise<{
  fresh: boolean;
  revision: string;
  observations: SourceObservation[];
  hashes: Record<string, string>;
}> {
  const relevant = repositories.filter((repo) => artifact.repositories.includes(basename(repo.path)) ||
    artifact.source_refs?.some((ref) => ref.repo === repo.path));
  const observations = await observeSources(artifact.source_refs ?? [], repositories, cache);
  const hashes = sourceHashes(observations);
  const version = artifact.repositories.map((name) => {
    const repo = relevant.find((entry) => basename(entry.path) === name);
    return [name, repo?.path, repo?.commit ?? null];
  });
  const revision = `code-${createHash('sha256').update(JSON.stringify([version, observations.map((item) =>
    [item.repo, item.path, item.hash ?? item.unavailable])])).digest('hex').slice(0, 24)}`;
  const fresh = artifact.repositories.length > 0 && artifact.repositories.every((name) => {
    const repo = relevant.find((entry) => basename(entry.path) === name);
    return Boolean(repo && (repo.commit
      ? repo.commit === artifact.source_commits[name]
      : !artifact.source_commits[name] && observations.some((item) => item.repo === repo.path && item.hash)));
  }) && observations.every((item) => item.hash && item.hash === artifact.source_hashes?.[sourceKey(item)]);
  return { fresh, revision, observations, hashes };
}
