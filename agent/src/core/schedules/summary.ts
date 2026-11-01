import type { BackgroundJob } from '../background/types.js';

export interface ScheduleSummary {
  id: string;
  kind?: 'background';
  backgroundStatus?: BackgroundJob['status'];
  backgroundJobIds?: string[];
  chatId: string;
  chatTitle: string;
  chatDeleted: boolean;
  prompt: string;
  status: 'scheduled' | 'running' | 'completed' | 'cancelled' | 'failed';
  dueAt?: number;
  everySeconds?: number;
  afterToolCallId?: string;
  model?: string;
  createdAt: number;
  lastRunId?: string;
  error?: string;
  activeRun?: { id: string; stopping: boolean };
}
