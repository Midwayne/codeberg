import { isAbsolute, join, relative, sep } from 'node:path';

import type { KnowledgeArtifact, RepositoryVersion } from '../types.js';
import { sourceKey, type SourceRef } from './reading.js';

/**
 * A project directory and the repositories under it are all roots. A citation
 * saved before the project was split names the directory; it now belongs to
 * the innermost repository that holds the file.
 */
export function canonicalRef<T extends SourceRef>(ref: T, repositories: RepositoryVersion[]): T {
  let best: { repo: string; path: string } | undefined;

  for (const repository of repositories) {
    const nested = nestedPath(ref.repo, repository.path);
    if (!nested || !insideDir(ref.path, nested)) continue;

    if (!best || repository.path.length > best.repo.length) {
      best = { repo: repository.path, path: relative(nested, ref.path).split(sep).join('/') };
    }
  }

  return best ? { ...ref, ...best } : ref;
}

/** canonicalRef for every citation, keeping saved file hashes keyed to match. */
export function canonicalArtifact(artifact: KnowledgeArtifact, repositories: RepositoryVersion[]): KnowledgeArtifact {
  if (!artifact.source_refs?.length) return artifact;

  const refs = artifact.source_refs.map((ref) => canonicalRef(ref, repositories));
  const hashes = artifact.source_hashes && rekeyHashes(artifact.source_hashes, repositories);

  return { ...artifact, source_refs: refs, ...(hashes && { source_hashes: hashes }) };
}

function rekeyHashes(hashes: Record<string, string>, repositories: RepositoryVersion[]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hashes).map(([key, hash]) => {
      const [repo = '', path = ''] = key.split('\0');

      return [sourceKey(canonicalRef({ repo, path }, repositories)), hash];
    }),
  );
}

/** `inner` relative to `outer` when it lies strictly inside it. */
function nestedPath(outer: string, inner: string): string | undefined {
  const rel = relative(outer, inner);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;

  return rel;
}

function insideDir(path: string, dir: string): boolean {
  const normalized = join(path);

  return normalized.startsWith(`${dir}${sep}`);
}
