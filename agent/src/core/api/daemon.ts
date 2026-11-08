/** Indexing progress as the daemon reports it inside `/health`. */
export interface IndexProgress {
  repo: string;
  phase: string;
  completed: number;
  total: number;
}

/**
 * The daemon's `/health` body (`daemon/internal/httpserver/health.go`). The
 * web server relays it unchanged as `GET /api/project/status`.
 */
export interface DaemonHealth {
  status?: string;
  pid?: number;
  ready: boolean;
  indexing?: boolean;
  progress?: IndexProgress;
  chunks: number;
  version: string;
  vectors_enabled: boolean;
  repos?: { key: string; ready: boolean; chunks: number }[];
}

/**
 * `GET /api/project/status`. While a project's indexer is still starting, the
 * daemon answers `{ ready: false, chunks: 0, status: 'indexing' }`.
 */
export type ProjectHealth = Pick<DaemonHealth, 'ready' | 'chunks'> &
  Partial<Omit<DaemonHealth, 'ready' | 'chunks'>>;
