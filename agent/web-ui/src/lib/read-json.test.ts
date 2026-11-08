import { expect, it } from 'vitest';

import { readJsonBody } from './read-json';

const fallback = 'Could not save the project name. Try again.';

it('returns parsed JSON and uses the response text when parsing fails', async () => {
  await expect(readJsonBody(Response.json({ name: 'Demo' }), fallback)).resolves.toEqual({ name: 'Demo' });
  await expect(readJsonBody(new Response('not json'), fallback)).rejects.toThrow('not json');
  await expect(readJsonBody(new Response(''), fallback)).rejects.toThrow(fallback);
});
