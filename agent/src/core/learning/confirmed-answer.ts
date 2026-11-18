import { stableId } from './store/identity.js';
import type { KnowledgeArtifact } from './types.js';

/** Solved answers saved without source-quoted claims; one per interaction. */
export function confirmedAnswerId(interactionId: string): string {
  return stableId('confirmed', interactionId);
}

/** The id prefix marks these notes for freshness checks and retirement. */
export function isConfirmedAnswer(artifact: Pick<KnowledgeArtifact, 'id'>): boolean {
  return artifact.id.startsWith('confirmed-');
}
