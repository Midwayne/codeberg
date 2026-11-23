import { expect, it, vi } from 'vitest';

import { markSessionRead, renameSession, saveSession } from './sessions';

const input = { id: 'chat', title: 'Question', messages: [] };

it.each([400, 403, 500])('reports HTTP %s instead of claiming a chat was saved', async (status) => {
  const api = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status }));

  await expect(saveSession(input, api)).rejects.toThrow(`Could not save chat (${status})`);
});

it('reports network failures when saving a chat', async () => {
  const api = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

  await expect(saveSession(input, api)).rejects.toThrow('Failed to fetch');
});

it('sends a rename as a title patch and reports failures', async () => {
  const api = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));

  await renameSession('chat', 'Auth investigation', api);

  expect(api).toHaveBeenCalledWith('/api/sessions/chat', expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ title: 'Auth investigation' }),
  }));

  api.mockResolvedValue(new Response('Unavailable', { status: 500 }));

  await expect(renameSession('chat', 'Auth investigation', api)).rejects.toThrow('Could not rename chat (500)');
});

it('marks a chat read without failing for one deleted meanwhile', async () => {
  const api = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

  await markSessionRead('chat', api);

  expect(api).toHaveBeenCalledWith('/api/sessions/chat', expect.objectContaining({
    method: 'PATCH',
    body: JSON.stringify({ read: true }),
  }));

  api.mockResolvedValue(new Response('Not found', { status: 404 }));
  await expect(markSessionRead('chat', api)).resolves.toBeUndefined();

  api.mockResolvedValue(new Response('Unavailable', { status: 500 }));
  await expect(markSessionRead('chat', api)).rejects.toThrow('Could not mark chat read (500)');
});
