export interface BrowserResult {
  status: 'completed' | 'incomplete' | 'error';
  result: string;
  urls?: string[];
  session_id?: string;
  kept_open?: boolean;
}

export interface BrowserTaskOptions {
  session_id?: string;
  keep_open?: boolean;
}

export interface WorkerResult extends BrowserResult {
  keepOpen: boolean;
}

export function parseWorkerResult(line: string): WorkerResult {
  let value: WorkerResult;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Invalid Browser Use worker response.');
  }
  if (!value || !['completed', 'incomplete', 'error'].includes(value.status) || typeof value.result !== 'string' ||
    value.result.length > 40_000 || typeof value.keepOpen !== 'boolean' ||
    (value.urls !== undefined && (!Array.isArray(value.urls) || value.urls.length > 50 ||
      value.urls.some((url) => typeof url !== 'string')))) throw new Error('Invalid Browser Use worker response.');

  return { status: value.status, result: value.result.slice(0, 20_000), urls: value.urls, keepOpen: value.keepOpen };
}
