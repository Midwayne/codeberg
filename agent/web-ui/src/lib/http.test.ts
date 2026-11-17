import { describe, expect, it } from 'vitest';

import { HttpError, ensureOk, jsonInit, readJson, responseError } from './http';

describe('responseError', () => {
  it('reads plain-text, { error } and { message } bodies the same way', async () => {
    const plain = await responseError(new Response('busy', { status: 409 }));
    const error = await responseError(new Response(JSON.stringify({ error: 'bad input' }), { status: 400 }));
    const message = await responseError(new Response(JSON.stringify({ message: 'gone' }), { status: 404 }));

    expect([plain.message, error.message, message.message]).toEqual(['busy', 'bad input', 'gone']);
    expect([plain.status, error.status, message.status]).toEqual([409, 400, 404]);
    expect(plain).toBeInstanceOf(HttpError);
  });

  it('falls back when the body is empty', async () => {
    const withFallback = await responseError(new Response('', { status: 500 }), 'Try again.');
    const withoutFallback = await responseError(new Response('', { status: 502 }));

    expect(withFallback.message).toBe('Try again.');
    expect(withoutFallback.message).toBe('Request failed (502)');
  });
});

describe('readJson and ensureOk', () => {
  it('returns the parsed body of a successful response', async () => {
    await expect(readJson(new Response(JSON.stringify({ ok: 1 })))).resolves.toEqual({ ok: 1 });
    await expect(ensureOk(new Response('{}'))).resolves.toBeUndefined();
  });

  it('throws the server message for a failed response', async () => {
    await expect(readJson(new Response('nope', { status: 503 }))).rejects.toThrow('nope');
    await expect(ensureOk(new Response('', { status: 500 }), 'Save failed.')).rejects.toThrow('Save failed.');
  });
});

describe('jsonInit', () => {
  it('serializes the body and keeps caller options', () => {
    const signal = new AbortController().signal;
    const init = jsonInit('PUT', { a: 1 }, { signal, headers: { 'X-Test': '1' } });

    expect(init).toEqual({
      signal,
      method: 'PUT',
      headers: { 'X-Test': '1', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
  });
});
