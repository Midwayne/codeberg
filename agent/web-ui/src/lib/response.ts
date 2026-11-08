/** A failed response uses its body as the error message. */
export async function ensureOk(response: Response): Promise<void> {
  if (!response.ok) throw new Error(await response.text());
}

export async function responseJson<T>(response: Response): Promise<T> {
  await ensureOk(response);

  return response.json() as Promise<T>;
}
