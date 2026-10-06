import { isAbsolute, join } from 'node:path';
import type {
  McpInterpolateContext,
  McpServer,
  McpStdioServer,
  McpTransportKind,
  McpUrlServer,
} from '../types.js';
import { defaultReadFile } from './io.js';
import type { ParseMcpJsonOptions } from './types.js';
import {
  asString,
  asStringArray,
  inferUrlKind,
  interpolateMap,
  interpolateMcpString,
  isExplicitFalse,
  isRecord,
  isTruthy,
  neverKind,
  normalizeKind,
  parseEnvFile,
} from './values.js';

export function parseServer(
  name: string,
  raw: unknown,
  ctx: McpInterpolateContext,
  opts: ParseMcpJsonOptions,
  warnings: string[],
): McpServer | undefined {
  if (!isRecord(raw)) {
    warnings.push(`server ${name}: entry must be an object`);

    return undefined;
  }

  if (isTruthy(raw.disabled) || (raw.enabled !== undefined && isExplicitFalse(raw.enabled))) {
    return undefined;
  }

  let kind: McpTransportKind | undefined;
  if (typeof raw.type === 'string' && raw.type.trim() !== '') {
    const normalized = normalizeKind(raw.type);
    if (normalized === 'unknown') {
      warnings.push(`server ${name}: unknown type ${JSON.stringify(raw.type)}`);

      return undefined;
    }

    kind = normalized;
  }

  const command = interpolateMcpString(asString(raw.command).trim(), ctx);
  const url = interpolateMcpString(asString(raw.url).trim(), ctx);
  if (kind === undefined) {
    if (command) kind = 'stdio';
    else if (url) kind = inferUrlKind(url);
  }

  if (kind === undefined) {
    warnings.push(`server ${name}: needs a command (stdio) or url (http/sse)`);

    return undefined;
  }

  return parseTransport(name, kind, raw, { command, url }, ctx, opts, warnings);
}

export function parseTransport(
  name: string,
  kind: McpTransportKind,
  raw: Record<string, unknown>,
  address: { command: string; url: string },
  ctx: McpInterpolateContext,
  opts: ParseMcpJsonOptions,
  warnings: string[],
): McpServer | undefined {
  const { command, url } = address;

  switch (kind) {
    case 'stdio':
      return parseStdioServer(name, command, raw, ctx, opts, warnings);
    case 'http':
    case 'sse': {
      if (!url) {
        warnings.push(`server ${name}: ${kind} transport requires url`);

        return undefined;
      }

      const server: McpUrlServer = {
        name,
        kind,
        url,
        headers: interpolateMap(raw.headers, ctx),
      };

      return server;
    }
    default:
      return neverKind(kind);
  }
}

export function parseStdioServer(
  name: string,
  command: string,
  raw: Record<string, unknown>,
  ctx: McpInterpolateContext,
  opts: ParseMcpJsonOptions,
  warnings: string[],
): McpStdioServer | undefined {
  if (!command) {
    warnings.push(`server ${name}: stdio transport requires command`);

    return undefined;
  }

  const env = loadStdioEnv(raw, ctx, opts, warnings, name);
  const cwdRaw = asString(raw.cwd).trim();
  const server: McpStdioServer = {
    name,
    kind: 'stdio',
    command,
    args: asStringArray(raw.args).map((a) => interpolateMcpString(a, ctx)),
    env,
    ...(cwdRaw ? { cwd: interpolateMcpString(cwdRaw, ctx) } : {}),
  };

  return server;
}

export function loadStdioEnv(
  raw: Record<string, unknown>,
  ctx: McpInterpolateContext,
  opts: ParseMcpJsonOptions,
  warnings: string[],
  name: string,
): Record<string, string> {
  const fromFile: Record<string, string> = {};
  const envFileRaw = asString(raw.envFile).trim();
  if (envFileRaw) {
    const expanded = interpolateMcpString(envFileRaw, ctx);
    const configDir = opts.configDir ?? ctx.workspaceFolder;
    const resolved = isAbsolute(expanded) ? expanded : join(configDir, expanded);
    const read = opts.readFile ?? defaultReadFile;
    const text = read(resolved);
    if (text == null) {
      warnings.push(`server ${name}: envFile not readable: ${resolved}`);
    } else {
      Object.assign(fromFile, parseEnvFile(text, ctx));
    }
  }

  return { ...fromFile, ...interpolateMap(raw.env, ctx) };
}
