/** Durable background job kinds; each runs through the shared learning queue. */
export type KnowledgeJobType =
  | 'extract_knowledge'
  | 'extract_dataset'
  | 'consolidate_knowledge'
  | 'evaluate_output'
  | 'extract_profile';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type FailureCategory =
  | 'NETWORK_ERROR'
  | 'MODEL_ERROR'
  | 'RATE_LIMITED'
  | 'REPOSITORY_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'PROCESS_CRASH'
  | 'PERMANENT_ERROR';

export interface KnowledgeJob {
  job_id: string;
  type: KnowledgeJobType;
  interaction_id: string;
  source_revision?: string;
  extraction_version?: number;
  source_code_revision?: string;
  /** Source-change refreshes can be paused independently of solved feedback. */
  source_refresh?: boolean;
  created_at: string;
  updated_at: string;
  attempt_count: number;
  status: JobStatus;
  last_error?: string;
  last_error_category?: FailureCategory;
  last_attempt_at?: string;
  next_attempt_at?: string;
  lease_expires_at?: string;
  rerun_requested?: boolean;
}
