import { jsonRequest, responseJson } from './response.js';

export async function dreamingRequest<T>(fetcher: typeof fetch, path = '', body?: unknown): Promise<T> {
  const response = await fetcher(`/api/learning/dreaming${path}`, {
    ...(body === undefined ? {} : jsonRequest('POST', body)),
    signal: AbortSignal.timeout(10_000),
  });

  return responseJson<T>(response, 'Knowledge consolidation request failed.');
}
