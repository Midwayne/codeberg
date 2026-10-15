/** USD rates per million tokens, supplied by the user's provider catalog. */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface UsageTokens {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export type UsageKind = 'chat' | 'learning';
export type UsageFilter = UsageKind | 'all';

export interface UsageRecord extends UsageTokens {
  id: string;
  timestamp: number;
  model: string;
  key: string;
  kind: UsageKind;
  project?: string;
  projectName?: string;
  costUsd: number | null;
}

export interface UsageTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  unpricedRequests: number;
  unreportedRequests: number;
}

export interface UsageSummary {
  totals: UsageTotals;
  kinds: Record<UsageKind, UsageTotals>;
  daily: (UsageTotals & { date: string })[];
  models: (UsageTotals & { model: string })[];
}

export interface UsageReport extends UsageSummary {
  failedWrites?: number;
  records: UsageRecord[];
  start: string;
  end: string;
  page: number;
  pageSize: number;
}
