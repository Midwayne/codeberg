import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

/** Serves built SPA assets or its index, returning false when no build is present. */
export async function serveStatic(
  res: ServerResponse,
  staticRoot: string | undefined,
  urlPath: string,
): Promise<boolean> {
  if (!staticRoot) {
    return false;
  }

  if (urlPath !== '/') {
    const file = safeJoin(staticRoot, urlPath);
    if (file) {
      try {
        const data = await readFile(file);
        res.writeHead(200, {
          'Content-Type': contentType(file),
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(data);
        return true;
      } catch {
        // not an asset — fall through to the SPA index
      }
    }
  }

  try {
    const html = await readFile(join(staticRoot, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  } catch {
    return false;
  }
}

/** Joins a URL path under root, returning null on any traversal escape. */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const full = resolve(join(root, decoded));
  const base = resolve(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}
