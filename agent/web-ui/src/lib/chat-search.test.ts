import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';

import { rankChatResults, type ChatSearchResult } from './chat-search';

describe('rankChatResults', () => {
  it('puts live current-chat answers before its prompts and other archived chats', () => {
    const messages = [
      { id: 'q', role: 'user', parts: [{ type: 'text', text: 'Where is cache refresh?' }] },
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Cache refresh happens here.' }] },
    ] as UIMessage[];
    const saved: ChatSearchResult[] = [{ id: 'old', title: 'Archived chat', role: 'assistant', messageId: 'a2', snippet: 'Cache refresh is automatic', pinned: false, archived: true, updatedAt: 1 }];
    const { current, others } = rankChatResults('cache refresh', 'now', 'Active chat', messages, saved);
    expect(current.map((hit) => hit.messageId)).toEqual(['a', 'q']);
    expect(others).toEqual(saved);
    expect(rankChatResults('cache refresh', 'now', 'Active chat', messages, saved, { archived: true, pinned: true }).current[0]).toMatchObject({ archived: true, pinned: true });
    expect(rankChatResults('', 'now', 'Active chat', messages, saved)).toEqual({ current: [], others: [] });
  });
});
