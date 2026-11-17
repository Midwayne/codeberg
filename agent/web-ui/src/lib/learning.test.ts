import { describe, expect, it } from 'vitest';

import { loadFeedback } from './learning';

function ratingsFetch(ratings: Record<string, unknown>) {
  const urls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    urls.push(String(input));

    return new Response(JSON.stringify(ratings), { status: 200 });
  }) as typeof fetch;

  return { fetcher, urls };
}

describe('loadFeedback', () => {
  it('shares one conversation request among the answers opened together', async () => {
    const { fetcher, urls } = ratingsFetch({ a1: { feedback_id: 'f1', rating: 3, label: 'solved' } });

    const [first, second] = await Promise.all([
      loadFeedback('chat-a', 'a1', fetcher),
      loadFeedback('chat-a', 'a2', fetcher),
    ]);

    expect(first?.label).toBe('solved');
    expect(second).toBeNull();
    expect(urls).toEqual(['/api/learning/feedback?conversation_id=chat-a']);
  });

  it('asks again on a later open so ratings saved elsewhere appear', async () => {
    const { fetcher, urls } = ratingsFetch({});

    await loadFeedback('chat-a', 'a1', fetcher);
    await loadFeedback('chat-a', 'a1', fetcher);
    await loadFeedback('chat-b', 'b1', fetcher);

    expect(urls).toHaveLength(3);
  });

  it('treats a failed request as unrated', async () => {
    const fetcher = (async () => new Response('busy', { status: 503 })) as typeof fetch;

    expect(await loadFeedback('chat-a', 'a1', fetcher)).toBeNull();
  });
});
