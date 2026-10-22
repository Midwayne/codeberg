import type { DaemonClient } from '../../client.js';
import { extractHybridHits } from '../../evidence-extract.js';
import { chunkKey } from '../../types.js';
import { boundBundle } from './output.js';
import { MAX_BUNDLE_HITS, validatePlan, type BundleError, type BundleHit, type BundleInput } from './types.js';

export async function collectBundle(daemon: DaemonClient, input: BundleInput, signal?: AbortSignal) {
  const queries = validatePlan(input);
  signal?.throwIfAborted();
  const errors: BundleError[] = [];
  const searches = await Promise.all(queries.map(async ({ repo, query }) => {
    try {
      const result = await daemon.callTool('hybrid_search', { repo, query, k: 8 }, signal);
      if (!Array.isArray(result)) throw new Error('Invalid search response');

      return result.slice(0, 8).flatMap((row, index) => {
        const hit = extractHybridHits([row])[0];
        if (!hit || (hit.repo && hit.repo !== repo)) return [];

        return [{ ...hit, repo, ...lexicalContext(result, index) }];
      });
    } catch (error) {
      signal?.throwIfAborted();
      errors.push({ repo, stage: 'search', error: String(error).slice(0, 200) });

      return [];
    }
  }));
  const ranked = interleave(searches);
  const selected = ranked.slice(0, MAX_BUNDLE_HITS);
  const expanded = await Promise.all(selected.map((hit) => expand(daemon, hit, errors, signal)));

  return boundBundle(expanded, errors, ranked.length - selected.length);
}

function interleave(groups: BundleHit[][]): BundleHit[] {
  const seen = new Set<string>();
  const hits: BundleHit[] = [];
  for (let rank = 0; rank < 8; rank++) {
    for (const group of groups) {
      const hit = group[rank];
      if (!hit || seen.has(chunkKey(hit))) continue;

      seen.add(chunkKey(hit));
      hits.push(hit);
    }
  }

  return hits;
}

async function expand(daemon: DaemonClient, hit: BundleHit, errors: BundleError[], signal?: AbortSignal): Promise<BundleHit> {
  if (hit.id <= 0) return hit;

  try {
    const detail = await daemon.callTool('get_chunk', { repo: hit.repo, id: hit.id }, signal);
    if (!detail || typeof detail !== 'object' || !('body' in detail) || typeof detail.body !== 'string') return hit;

    return { ...hit, body: detail.body, truncated: 'truncated' in detail && detail.truncated === true };
  } catch (error) {
    signal?.throwIfAborted();
    errors.push({ repo: hit.repo ?? '', stage: 'chunk', error: String(error).slice(0, 200) });

    return hit;
  }
}

function lexicalContext(output: unknown, index: number): Pick<BundleHit, 'body' | 'truncated'> {
  if (!Array.isArray(output)) return {};

  const row = output[index];

  return row?.hit?.id === 0 && typeof row.context === 'string'
    ? { body: row.context, truncated: row.context_truncated === true }
    : {};
}
