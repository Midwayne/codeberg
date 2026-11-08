/** A JSON request body with the matching content type. */
export function jsonRequest(method: string, body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  };
}

/** A failed response uses its body as the error message. */
export async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) throw new Error(await response.text());
}

export async function responseJson<T>(response: Response): Promise<T> {
  await ensureOk(response);

  return response.json() as Promise<T>;
}
