import { createHash } from 'node:crypto';
import type { KnowledgeArtifact } from '../types.js';

export function artifactFingerprint(artifact: KnowledgeArtifact): string {
  // Markdown parsing normalizes the body; object key order is not part of a revision.
  function normalized(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalized);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalized(item)]));
    return value;
  }
  return createHash('sha256').update(JSON.stringify(normalized({ ...artifact, body: artifact.body.trim() }))).digest('hex');
}
