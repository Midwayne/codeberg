import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import type { KnowledgeArtifact, RepositoryVersion } from '../types.js';

export type SourceRef = NonNullable<KnowledgeArtifact['source_refs']>[number];

export interface SourceObservation extends SourceRef {
  commit?: string;
  hash?: string;
  excerpt?: string;
  excerpt_start_line?: number;
  truncated?: boolean;
  unavailable?: string;
}

// Retain freshly read source for quote validation without sending whole files to the model.
export const sourceText = new WeakMap<SourceObservation, string>();

export function sourceTextFor(observation: SourceObservation): string | undefined {
  return sourceText.get(observation);
}

export function sourceKey(ref: SourceRef): string {
  return `${ref.repo}\0${ref.path}`;
}

export async function readSource(
  ref: SourceRef,
  repositories: RepositoryVersion[],
): Promise<SourceObservation> {
  const repo = repositories.find((entry) => entry.path === ref.repo);
  if (!repo) return { ...ref, unavailable: 'repository not available' };

  try {
    const root = await realpath(repo.path);
    const path = resolve(root, ref.path);
    const location = relative(root, path);
    if (!location || location === '..' || location.startsWith(`..${sep}`)) {
      throw new Error('invalid repository-relative path');
    }

    const actual = await realpath(path);
    if (!actual.startsWith(`${root}${sep}`)) throw new Error('source is outside the repository');

    if ((await stat(actual)).size > 1_000_000)
      throw new Error('source file exceeds safe read limit');

    const content = await readFile(actual);
    const text = content.toString('utf8');
    const hash = createHash('sha256').update(content).digest('hex');
    const needle = ref.symbol?.split(/[.#:]/).at(-1);
    const position = needle ? Math.max(0, text.indexOf(needle) - 1_500) : 0;
    const excerpt = text.slice(position, position + 12_000);
    const excerpt_start_line = 1 + (text.slice(0, position).match(/\n/g)?.length ?? 0);
    const observation = {
      ...ref,
      commit: repo.commit,
      hash,
      excerpt,
      excerpt_start_line,
      truncated: excerpt.length < text.length,
    };

    sourceText.set(observation, text);

    return observation;
  } catch (error) {
    return { ...ref, commit: repo.commit, unavailable: String(error) };
  }
}
