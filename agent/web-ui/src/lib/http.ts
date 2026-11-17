/** A failed API response: the server's message plus the HTTP status. */
export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Builds the error for a failed response. Routes answer with plain text,
 * `{ error }` or `{ message }`; all three become the error's message.
 */
export async function responseError(response: Response, fallback?: string): Promise<HttpError> {
  const text = await response.text().catch(() => '');

  return new HttpError(messageFrom(text) || fallback || `Request failed (${response.status})`, response.status);
}

/** Parses a successful JSON body, or throws the response's {@link HttpError}. */
export async function readJson<T>(response: Response, fallback?: string): Promise<T> {
  if (!response.ok) throw await responseError(response, fallback);

  return await response.json() as T;
}

/** Throws the response's {@link HttpError} unless it succeeded. */
export async function ensureOk(response: Response, fallback?: string): Promise<void> {
  if (!response.ok) throw await responseError(response, fallback);
}

/** Request options for a JSON body. */
export function jsonInit(method: string, body: unknown, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    method,
    headers: { ...init.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function messageFrom(text: string): string {
  try {
    const value = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof value?.error === 'string') return value.error;

    if (typeof value?.message === 'string') return value.message;
  } catch {
    // Plain-text bodies are the message.
  }

  return text.trim();
}
