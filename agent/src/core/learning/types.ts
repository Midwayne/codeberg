export const FEEDBACK_LABELS = [
  'not_useful',
  'partially_useful',
  'mostly_correct',
  'solved',
] as const;

export type FeedbackLabel = (typeof FEEDBACK_LABELS)[number];
export type FeedbackRating = 0 | 1 | 2 | 3;

export interface RepositoryVersion {
  path: string;
  branch?: string;
  commit?: string;
}

export interface ToolInvocation {
  name: string;
  tool_call_id?: string;
  input?: unknown;
  output?: unknown;
  timestamp?: string;
  duration_ms?: number;
  state?: string;
}

export interface RetrievedResult {
  tool: string;
  tool_call_id?: string;
  rank: number;
  score?: number;
  repo?: string;
  path?: string;
  symbol?: string;
  start_line?: number;
  end_line?: number;
  snippet?: string;
  search_query?: string;
  opened?: boolean;
}

export interface TrajectoryStep {
  kind: 'user' | 'tool_call' | 'observation' | 'answer';
  text?: string;
  tool?: string;
  tool_call_id?: string;
  payload?: unknown;
  timestamp?: string;
}

export interface AttemptRecord {
  conversation_id: string;
  interaction_id: string;
  parent_interaction_id?: string;
  attempt_id: string;
  assistant_message_id: string;
  timestamp: string;
  user_query: string;
  answer: string;
  repositories: RepositoryVersion[];
  search_queries: string[];
  retrieved_results: RetrievedResult[];
  files_inspected: string[];
  symbols_inspected: string[];
  tools_invoked: ToolInvocation[];
  evidence_used: RetrievedResult[];
  trajectory?: TrajectoryStep[];
  model?: string;
  token_usage?: { input?: number; output?: number; retrieved?: number };
  latency_ms?: number;
  available_tools?: string[];
  tool_versions?: Record<string, string>;
}

export interface FeedbackRecord {
  feedback_id: string;
  attempt_id: string;
  timestamp: string;
  rating: FeedbackRating;
  label: FeedbackLabel;
  reason?: string;
  supersedes_feedback_id?: string;
}

export interface LearningEventBase {
  event_id: string;
  timestamp: string;
}

export interface AttemptEvent extends LearningEventBase {
  type: 'attempt_recorded';
  attempt: AttemptRecord;
}

export interface FeedbackEvent extends LearningEventBase {
  type: 'feedback_recorded';
  feedback: FeedbackRecord;
}

export type LearningEvent = AttemptEvent | FeedbackEvent;

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
  type: 'extract_knowledge' | 'extract_dataset';
  interaction_id: string;
  source_revision?: string;
  extraction_version?: number;
  source_code_revision?: string;
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

export type KnowledgeCategory = 'services' | 'flows' | 'concepts' | 'debugging';
export type KnowledgeConfidence = 'low' | 'medium' | 'high';
export type KnowledgeStatus = 'active' | 'needs_verification';

export interface KnowledgeClaim {
  statement: string;
  evidence: { repo: string; path: string; quote: string; symbol?: string; start_line?: number; end_line?: number }[];
}

export interface KnowledgeArtifact {
  id: string;
  title: string;
  category: KnowledgeCategory;
  slug: string;
  created_at: string;
  updated_at: string;
  last_verified_at: string;
  repositories: string[];
  source_interactions: string[];
  /** Older interactions retained for provenance but not used to verify current claims. */
  historical_source_interactions?: string[];
  /** Attempt and feedback revision last used to verify this interaction's evidence. */
  source_revision?: string;
  source_revisions?: Record<string, string>;
  source_commits: Record<string, string>;
  source_refs?: { repo: string; path: string; symbol?: string }[];
  source_hashes?: Record<string, string>;
  claims?: KnowledgeClaim[];
  /** Explicit solved user corrections, retained as provisional notes rather than source-verified claims. */
  user_confirmed_notes?: {
    interaction_id: string;
    source_revision: string;
    text: string;
    confirmed_at: string;
    provenance: 'user_confirmed';
  }[];
  confidence: KnowledgeConfidence;
  status: KnowledgeStatus;
  body: string;
}

export interface LearningSearchHit {
  score: number;
  attempt: AttemptRecord;
  feedback?: FeedbackRecord;
}

export interface KnowledgeSearchHit {
  score: number;
  artifact: KnowledgeArtifact;
}
