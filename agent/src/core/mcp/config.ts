import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { builtinDatabaseServer } from './builtin.js';
import type {
  McpConfig,
  McpConfigIo,
  McpInterpolateContext,
  McpServer,
  McpStdioServer,
  McpTransportKind,
  McpUrlServer,
} from './types.js';

const MCP_FILE = 'mcp.json';

/** A flag env var: anything but 0/false/off/no (case-insensitive) is "on". */
function flag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return !/^(0|false|off|no)$/i.test(value.trim());
}

function splitList(v: string): string[] {
  const out: string[] = [];
  for (const item of v.split(',')) {
    const t = item.trim();
    if (t) out.push(t);
  }
  return out;
}

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string {
  return v == null ? '' : String(v);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

function interpolateMap(raw: unknown, ctx: McpInterpolateContext): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = interpolateMcpString(asString(v), ctx);
  }
  return out;
}

function isTruthy(v: unknown): boolean {
  return v === true || v === 1 || v === 'true' || v === '1';
}

function isExplicitFalse(v: unknown): boolean {
  return v === false || v === 0 || v === 'false' || v === '0';
}

const REF = /\$\{([^}]+)\}/g;

/** Expand Cursor/VS Code style `${env:NAME}`, `${workspaceFolder}`, `${userHome}`. */
export function interpolateMcpString(value: string, ctx: McpInterpolateContext): string {
  return value.replace(REF, (_, raw: string) => resolveRef(String(raw).trim(), ctx));
}

function resolveRef(raw: string, ctx: McpInterpolateContext): string {
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

function normalizeKind(type: string): McpTransportKind | 'unknown' {
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

function inferUrlKind(url: string): 'http' | 'sse' {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (pathname === '/sse' || pathname.endsWith('/sse')) return 'sse';
  } catch {
    // not a valid URL — fall through to a conservative substring check
  }
  return /(?:^|\/)sse(?:\/|$|\?)/i.test(url) ? 'sse' : 'http';
}

function neverKind(x: never): never {
  throw new Error(`unexpected MCP transport: ${String(x)}`);
}

function parseEnvFile(text: string, ctx: McpInterpolateContext): Record<string, string> {
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

export interface ParseMcpJsonOptions {
  /** Directory of the mcp.json file, used to resolve `envFile`. */
  configDir?: string;
  readFile?: (path: string) => string | null;
}

/**
 * Parse a Cursor-compatible MCP JSON document (`mcpServers`, or VS Code `servers`).
 * Invalid documents yield warnings and an empty server list rather than throwing.
 */
export function parseMcpJson(
  text: string,
  ctx: McpInterpolateContext,
  opts: ParseMcpJsonOptions = {},
): { servers: McpServer[]; warnings: string[] } {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { servers: [], warnings: [`invalid JSON (${msg})`] };
  }
  if (!isRecord(parsed)) {
    return { servers: [], warnings: ['MCP config root must be a JSON object'] };
  }

  const fromAlias = isRecord(parsed.servers) ? parsed.servers : {};
  const fromNative = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  // VS Code `servers` first, Cursor `mcpServers` last so a shared document
  // prefers the Cursor-native key on a name collision.
  const entries: Record<string, unknown> = { ...fromAlias, ...fromNative };

  const servers: McpServer[] = [];
  for (const [name, raw] of Object.entries(entries)) {
    const server = parseServer(name, raw, ctx, opts, warnings);
    if (server) servers.push(server);
  }
  return { servers, warnings };
}

function parseServer(
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

  switch (kind) {
    case 'stdio': {
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

function loadStdioEnv(
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

function defaultExists(path: string): boolean {
  return existsSync(path);
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function findGitRoot(cwd: string, exists: (path: string) => boolean): string {
  let dir = resolve(cwd);
  for (;;) {
    if (exists(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}

function projectMcpFiles(root: string): string[] {
  return [join(root, '.cursor', MCP_FILE), join(root, '.codeberg', MCP_FILE)];
}

/**
 * Config files in merge order (later overrides the same server name):
 * `~/.codeberg/mcp.json`, then each indexed root's `.cursor/mcp.json` and
 * `.codeberg/mcp.json`, then `CODEBERG_MCP_CONFIG`. When no indexed roots are
 * set, the git project (or cwd) is used instead of cwd itself — the launcher
 * sets cwd to the codeberg checkout, which is not the repo being indexed.
 */
export function discoverMcpConfigPaths(opts: {
  home: string;
  roots: string[];
  cwd: string;
  extra: string[];
  exists?: (path: string) => boolean;
}): string[] {
  const exists = opts.exists ?? defaultExists;
  const candidates: string[] = [join(opts.home, MCP_FILE)];
  const roots = opts.roots.length > 0 ? opts.roots : [findGitRoot(opts.cwd, exists)];
  for (const root of roots) {
    candidates.push(...projectMcpFiles(root));
  }
  candidates.push(...opts.extra);
  return candidates.filter((p) => exists(p));
}

/** Indexed-repo directories from CODEBERG_ROOTS (preferred) or CODEBERG_ROOT. */
export function indexedRootsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const roots = env.CODEBERG_ROOTS;
  if (roots != null && roots.trim() !== '') {
    const out: string[] = [];
    for (const line of roots.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const tab = trimmed.indexOf('\t');
      out.push(tab >= 0 ? trimmed.slice(tab + 1).trim() : trimmed);
    }
    return out.filter(Boolean);
  }
  return splitList(env.CODEBERG_ROOT ?? '');
}

function workspaceForConfig(configPath: string, fallback: string): string {
  const dir = dirname(configPath);
  const parent = dirname(dir);
  const base = dir.split(/[/\\]/).pop();
  if (base === '.cursor' || base === '.codeberg') return parent;
  return fallback;
}

/**
 * Resolve MCP config from the environment and mcp.json files. Missing files
 * are not an error; invalid files become warnings. User servers are disabled
 * via `CODEBERG_MCP_USE=false`. The built-in database server is separate and
 * off unless `CODEBERG_DBMCP_USE` is set; it is registered only when a spec
 * file and the `dbmcp` binary are both present. A later mcp.json entry named
 * `databases` replaces that built-in command.
 */
export function mcpConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  io: McpConfigIo = {},
): McpConfig {
  const userEnabled = flag(env.CODEBERG_MCP_USE, true);
  const dbEnabled = flag(env.CODEBERG_DBMCP_USE, false);
  if (!userEnabled && !dbEnabled) {
    return { enabled: false, servers: [], files: [], warnings: [] };
  }

  const home =
    env.CODEBERG_HOME && env.CODEBERG_HOME.trim() !== ''
      ? env.CODEBERG_HOME
      : join((io.homedir ?? homedir)(), '.codeberg');
  const cwd = io.cwd ?? process.cwd();
  const userHome = (io.homedir ?? homedir)();
  const exists = io.exists ?? defaultExists;
  const readFile = io.readFile ?? defaultReadFile;
  const warnings: string[] = [];
  const merged: Record<string, McpServer> = {};

  const builtin = builtinDatabaseServer({
    env,
    home,
    userHome,
    io: { ...io, cwd, exists },
  });
  warnings.push(...builtin.warnings);
  if (builtin.server) merged[builtin.server.name] = builtin.server;

  const files: string[] = [];
  if (userEnabled) {
    const roots = indexedRootsFromEnv(env);
    const extra = splitList(env.CODEBERG_MCP_CONFIG ?? '').map((p) => expandHome(p, userHome));
    files.push(...discoverMcpConfigPaths({ home, roots, cwd, extra, exists }));
    const fallbackWorkspace = roots[0] ?? cwd;
    for (const file of files) {
      loadMcpFile(file, env, userHome, fallbackWorkspace, readFile, merged, warnings);
    }
  }

  return {
    enabled: true,
    servers: Object.values(merged),
    files,
    warnings,
  };
}

function loadMcpFile(
  file: string,
  env: NodeJS.ProcessEnv,
  userHome: string,
  fallbackWorkspace: string,
  readFile: (path: string) => string | null,
  merged: Record<string, McpServer>,
  warnings: string[],
): void {
  const text = readFile(file);
  if (text == null) {
    warnings.push(`${file}: not readable`);
    return;
  }
  const ctx: McpInterpolateContext = {
    env,
    workspaceFolder: workspaceForConfig(file, fallbackWorkspace),
    userHome,
  };
  const parsed = parseMcpJson(text, ctx, { configDir: dirname(file), readFile });
  for (const w of parsed.warnings) {
    warnings.push(`${file}: ${w}`);
  }
  for (const server of parsed.servers) {
    merged[server.name] = server;
  }
}
