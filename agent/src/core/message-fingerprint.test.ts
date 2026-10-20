import { expect, it } from 'vitest';

import { canonical, fingerprintMessage } from './message-fingerprint.js';

it('fingerprints binary attachments without JSON byte arrays', () => {
  const value = { data: Buffer.alloc(1000000, 7) };

  expect(canonical(value).length).toBeLessThan(200);
  expect(canonical(value)).toBe(canonical({ data: new Uint8Array(value.data) }));
});

it('ignores cache hints while preserving meaningful JSON fields with the same name', () => {
  const message = { role: 'tool', content: [{ type: 'tool-result', toolName: 'read', toolCallId: '1',
    output: { type: 'json', value: { providerOptions: 'original' } } }] };
  const hinted = { ...message, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } };

  expect(fingerprintMessage(hinted)).toBe(fingerprintMessage(message));
  expect(fingerprintMessage(message)).not.toBe(fingerprintMessage({ ...message, content: [
    { ...message.content[0], output: { type: 'json', value: { providerOptions: 'edited' } } },
  ] }));

  expect(fingerprintMessage({ role: 'assistant', content: [{ type: 'custom', providerOptions: { value: 'one' } }] }))
    .not.toBe(fingerprintMessage({ role: 'assistant', content: [{ type: 'custom', providerOptions: { value: 'two' } }] }));

  expect(fingerprintMessage({ role: 'user', content: [{ type: 'image', image: 'url', providerOptions: { openai: { imageDetail: 'high' } } }] }))
    .not.toBe(fingerprintMessage({ role: 'user', content: [{ type: 'image', image: 'url', providerOptions: { openai: { imageDetail: 'low' } } }] }));
});
