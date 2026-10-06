import { projectFetch } from '../lib/project-api';

export function canvasProject(): string | null {
  return new URL(location.href).searchParams.get('project');
}

export function canvasFetch(): typeof fetch {
  const params = new URL(location.href).searchParams;
  const project = params.get('project');
  const request = project ? projectFetch(project) : (...args: Parameters<typeof fetch>) => globalThis.fetch(...args);

  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    url.searchParams.set('chat', params.get('chat') ?? '');
    return request(url.href, init);
  };
}

export function canvasUrl(chatId: string, project?: string, embedded = false): string {
  const params = new URLSearchParams({ chat: chatId });
  if (project) params.set('project', project);

  if (embedded) params.set('embedded', '1');

  return `/canvas?${params}`;
}

export function canvasEmbedded(): boolean {
  return new URL(location.href).searchParams.get('embedded') === '1';
}
