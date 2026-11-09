/** A JSON request body with the matching content type. */
export function jsonRequest(method: string, body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  };
}

/** A failed response uses its body as the error message, else `fallback`. */
export async function ensureOk(response: Response, fallback?: string): Promise<void> {
  if (response.ok) return;

  throw new Error((await response.text()) || fallback || `Request failed (${response.status})`);
}

export async function responseJson<T>(response: Response, fallback?: string): Promise<T> {
  await ensureOk(response, fallback);

  return response.json() as Promise<T>;
}
