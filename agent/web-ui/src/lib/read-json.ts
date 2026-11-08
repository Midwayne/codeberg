export async function readJsonBody<Body>(response: Response, fallback: string): Promise<Body> {
  const text = await response.text();

  try {
    return JSON.parse(text) as Body;
  } catch {
    throw new Error(text || fallback);
  }
}
