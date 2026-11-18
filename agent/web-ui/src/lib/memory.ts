import type { ProfileNote } from '@agent/core/learning/profile/types';
import type { KnowledgeArtifact } from '@agent/core/learning/types';
import { ensureOk, readJson } from './http';

export type { ProfileNote };

export type MemoryKnowledge = Pick<KnowledgeArtifact, 'id' | 'title' | 'category' | 'status' | 'confidence' | 'updated_at'> & {
  /** Times chats retrieved this finding through search_knowledge. */
  uses: number;
  last_used_at?: string;
};

export type MemoryDashboard = {
  profile: ProfileNote[];
  knowledge: MemoryKnowledge[];
  /** Knowledge and profile jobs waiting or running. */
  pending: number;
  errors: { type: string; status: string; error?: string }[];
};

export async function loadMemory(fetcher: typeof fetch = fetch): Promise<MemoryDashboard> {
  const response = await fetcher('/api/learning/memory', { signal: AbortSignal.timeout(10_000) });

  return readJson<MemoryDashboard>(response, 'Could not load saved memory.');
}

export async function removeProfileNote(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`/api/learning/memory/profile/${encodeURIComponent(id)}`, { method: 'DELETE' });

  await ensureOk(response, 'Could not remove the note.');
}
