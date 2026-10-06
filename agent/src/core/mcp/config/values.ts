import { join } from 'node:path';
import type { McpInterpolateContext, McpTransportKind } from '../types.js';

/** A flag env var: anything but 0/false/off/no (case-insensitive) is "on". */
export function flag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;

  return !/^(0|false|off|no)$/i.test(value.trim());
}

export function splitList(v: string): string[] {
  const out: string[] = [];
  for (const item of v.split(',')) {
    const t = item.trim();
    if (t) out.push(t);
  }

  return out;
}

export function expandHome(p: string, home: string): string {
  if (p === '~') return home;

  if (p.startsWith('~/')) return join(home, p.slice(2));

  return p;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];

  return v.map((x) => String(x));
}

export function interpolateMap(raw: unknown, ctx: McpInterpolateContext): Record<string, string> {
  if (!isRecord(raw)) return {};

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = interpolateMcpString(asString(v), ctx);
  }

  return out;
}

export function isTruthy(v: unknown): boolean {
  return v === true || v === 1 || v === 'true' || v === '1';
}

export function isExplicitFalse(v: unknown): boolean {
  return v === false || v === 0 || v === 'false' || v === '0';
}

export const REF = /\$\{([^}]+)\}/g;

/** Expand Cursor/VS Code style `${env:NAME}`, `${workspaceFolder}`, `${userHome}`. */
export function interpolateMcpString(value: string, ctx: McpInterpolateContext): string {
  return value.replace(REF, (_, raw: string) => resolveRef(String(raw).trim(), ctx));
}

export function resolveRef(raw: string, ctx: McpInterpolateContext): string {
  if (raw.startsWith('input:')) return '';

  const key = raw.startsWith('env:') ? raw.slice(4) : raw;
  switch (key) {
    case 'workspaceFolder':
    case 'workspaceRoot':
      return ctx.workspaceFolder;
    case 'userHome':
    case 'home':
      return ctx.userHome;
    default:
      return ctx.env[key] ?? '';
  }
}

export function normalizeKind(type: string): McpTransportKind | 'unknown' {
  const t = type.trim().toLowerCase().replace(/_/g, '-');
  switch (t) {
    case 'stdio':
    case 'stdio-transport':
      return 'stdio';
    case 'http':
    case 'streamable-http':
    case 'streamablehttp':
      return 'http';
    case 'sse':
    case 'server-sent-events':
      return 'sse';
    default:
      return 'unknown';
  }
}

export function inferUrlKind(url: string): 'http' | 'sse' {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (pathname === '/sse' || pathname.endsWith('/sse')) return 'sse';
  } catch {
    // not a valid URL — fall through to a conservative substring check
  }

  return /(?:^|\/)sse(?:\/|$|\?)/i.test(url) ? 'sse' : 'http';
}

export function neverKind(x: never): never {
  throw new Error(`unexpected MCP transport: ${String(x)}`);
}

export function parseEnvFile(text: string, ctx: McpInterpolateContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const stripped = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;

    const key = stripped.slice(0, eq).trim();
    let val = stripped.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (key) out[key] = interpolateMcpString(val, ctx);
  }

  return out;
}
