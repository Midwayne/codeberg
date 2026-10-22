import { safeCut } from '../../context/limits.js';
import { MAX_BUNDLE_CHARS, type BundleError, type BundleHit, type EvidenceBundle } from './types.js';

/** Budget the serialized result, including escaping, metadata, and partial failures. */
export function boundBundle(hits: BundleHit[], errors: BundleError[], omitted: number): EvidenceBundle {
  const bundle: EvidenceBundle = { evidence: [], errors: errors.slice(0, 12), omitted };
  let bodyBudget = 6_000;
  for (const hit of hits) {
    const body = hit.body?.slice(0, safeCut(hit.body, Math.min(1_500, bodyBudget)));
    const row = { ...hit, snippet: hit.snippet.slice(0, 160), ...(body === undefined ? {} : {
      body, truncated: hit.truncated || body.length < hit.body!.length,
    }) };
    bundle.evidence.push(row);
    while (JSON.stringify(bundle).length > MAX_BUNDLE_CHARS && row.body?.length) {
      row.body = row.body.slice(0, safeCut(row.body, Math.floor(row.body.length / 2)));
      row.truncated = true;
    }
    if (JSON.stringify(bundle).length > MAX_BUNDLE_CHARS) {
      bundle.evidence.pop();
      bundle.omitted++;
    } else bodyBudget -= row.body?.length ?? 0;
  }

  return bundle;
}
