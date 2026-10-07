import { canvas, example, extensions, learning, models, projects, review } from './fixtures';
import { resourceReport, usageReport } from './reports';

/** Only the demo entry installs this transport; real UI builds use the server. */
export function installDemoApi(delay: number): void {
  const original = globalThis.fetch;
  const demoFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return original(input, init);

    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    await waitForDemo(delay, signal);

    return demoResponse(url, init);
  };
  globalThis.fetch = demoFetch;
  import.meta.hot?.dispose(() => {
    globalThis.fetch = original;
  });
}

function demoResponse(url: URL, init?: RequestInit): Response {
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const routes: Record<string, unknown> = {
    '/api/projects': projects,
    '/api/project/status': { ready: true, chunks: 240 },
    '/api/meta': { title: 'Demo model', capabilities: { learning: true } },
    '/api/models': models,
    '/api/learning/settings': learning,
    '/api/learning/status': { working: false, active: 0 },
    '/api/learning/dreaming': { reports: [], jobs: [], canGenerate: false },
    '/api/learning/review': review,
    '/api/learning/review/example': example,
    '/api/extensions': extensions,
    '/api/commands': [],
    '/api/sessions': [],
    '/api/settings/canvas': canvas,
    '/api/settings/resources': resourceReport(),
    '/api/settings/usage': usageReport(url),
    '/api/settings/cleanup': init?.method === 'POST'
      ? { deleted: 3, failed: 0, bytesFreed: 1024, deletedChatIds: [] }
      : { categories: ['chats', 'training', 'knowledge'].map((category) => ({ category, count: 3, bytes: 1024 })) },
  };
  const value = routes[url.pathname];
  if (value !== undefined) {
    if (init?.method === 'PUT' && typeof value === 'object' && value !== null) Object.assign(value, body);

    return Response.json(value);
  }
  if (url.pathname.startsWith('/api/sessions/') && init?.method) return Response.json({});

  return new Response('This action is unavailable in the motion demo.', { status: 404 });
}

function waitForDemo(delay: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);

    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
