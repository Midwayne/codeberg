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

export type CanvasUrlOptions = {
  project?: string;
  embedded?: boolean;
  motion?: 'none';
};

export function canvasUrl(chatId: string, options: CanvasUrlOptions = {}): string {
  const params = new URLSearchParams({ chat: chatId });

  if (options.project) params.set('project', options.project);
  if (options.embedded) params.set('embedded', '1');
  if (options.motion) params.set('motion', options.motion);

  return `/canvas?${params}`;
}

export function canvasMotion(): string | null {
  return new URL(location.href).searchParams.get('motion');
}

export function canvasEmbedded(): boolean {
  return new URL(location.href).searchParams.get('embedded') === '1';
}
