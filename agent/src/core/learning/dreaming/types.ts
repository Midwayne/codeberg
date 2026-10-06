import type { KnowledgeArtifact } from '../types.js';

export interface DreamingPlan {
  summary: string;
  merges: { target_id: string; source_ids: string[]; reason: string }[];
  links: { from_id: string; to_id: string; reason: string }[];
}
export interface DreamingChange {
  before: KnowledgeArtifact;
  after: KnowledgeArtifact;
  reason: string;
}
export type DreamingDecision = 'apply' | 'undo' | 'dismiss';
export interface DreamingReport {
  schema_version: 1;
  id: string;
  created_at: string;
  summary: string;
  /** Whole-record revisions considered, including records with no proposed changes. */
  inputs?: { id: string; fingerprint: string }[];
  considered: number;
  omitted: number;
  changes: DreamingChange[];
  status: 'proposed' | 'applied' | 'undone' | 'dismissed';
  decisions: { action: DreamingDecision; timestamp: string }[];
}
