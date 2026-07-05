import { isIP } from 'node:net';

/**
 * Cloud metadata endpoints that must never be fetched. 169.254.169.254 is also
 * caught by the link-local rule, but cloud DNS names are not, so block them by
 * name too.
 */
const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal', 'metadata.goog']);

/** True when a hostname/IP is loopback, link-local, or RFC-1918 private. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true; // mDNS / Bonjour
  const version = isIP(host);
  if (version === 4) return isPrivateIPv4(host);
  if (version === 6) return isPrivateIPv6(host);
  return false; // a DNS name we cannot classify without resolving it
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed — treat as unsafe
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const host = ip.toLowerCase();
  if (host === '::1' || host === '::') return true; // loopback / unspecified
  if (host.startsWith('fe80')) return true; // link-local
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // unique-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host); // IPv4-mapped
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

/**
 * Validate a model-supplied URL before fetching it: http/https only, no blocked
 * metadata hosts, and (unless `allowPrivate`) no loopback/private targets.
 * Throws a clear, model-readable error; returns the parsed URL on success.
 */
export function assertFetchableUrl(raw: string, opts: { allowPrivate: boolean }): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`unsupported URL scheme "${url.protocol}" — only http and https are allowed`);
  }
  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new Error(`refusing to fetch blocked host ${url.hostname}`);
  }
  if (!opts.allowPrivate && isPrivateHost(url.hostname)) {
    throw new Error(
      `refusing to fetch private/loopback host ${url.hostname} ` +
        `(set CODEBERG_WEB_ALLOW_PRIVATE=1 to allow)`,
    );
  }
  return url;
}
