import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { envFlag, expandHome } from '../paths.js';
import type { McpConfigIo, McpStdioServer } from './types.js';

/** MCP server name for the built-in multi-db server. Tools are `mcp_databases_<tool>`. */
export const DBMCP_SERVER_NAME = 'databases';

/** Spec filenames in the codeberg config directory, first match wins. */
const SPEC_NAMES = ['spec.yml', 'spec.yaml'] as const;

const WALK_LIMIT = 8;

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function moduleDir(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return undefined;
  }
}

function looksLikeCodebergRoot(dir: string, exists: (path: string) => boolean): boolean {
  if (exists(join(dir, 'third_party', 'multi-db-mcp-server', 'go.mod'))) return true;
  if (exists(join(dir, 'Makefile')) && exists(join(dir, 'agent'))) return true;
  // Prebuilt layout: <root>/build/dbmcp next to agent/ and core/.
  return exists(join(dir, 'agent')) && exists(join(dir, 'core'));
}

function findBuiltBinary(starts: string[], exists: (path: string) => boolean): string | undefined {
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < WALK_LIMIT; i++) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const bin = join(dir, 'build', 'dbmcp');
      if (looksLikeCodebergRoot(dir, exists) && exists(bin)) return bin;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

export interface BuiltinDatabaseOptions {
  env: NodeJS.ProcessEnv;
  /** Codeberg config directory (`CODEBERG_HOME`, default `~/.codeberg`). */
  home: string;
  userHome: string;
  io?: McpConfigIo;
}

export interface BuiltinDatabaseResult {
  server?: McpStdioServer;
  warnings: string[];
}

/**
 * Built-in multi-db MCP server (the `third_party/multi-db-mcp-server` submodule).
 * Off unless `CODEBERG_DBMCP_USE` is set. Requires a spec file (`spec.yml`, then
 * `spec.yaml`, or `CODEBERG_DBMCP_SPEC`) and a built `dbmcp` binary. Tool
 * schemas come from the server at connect time, so upstream tool changes do
 * not need agent edits — pull them with `make update-dbmcp`.
 *
 * The stdio transport only inherits a small default env, so the child receives
 * the agent environment. Spec files expand `${VAR}` inside that process.
 */
export function builtinDatabaseServer(opts: BuiltinDatabaseOptions): BuiltinDatabaseResult {
  const warnings: string[] = [];
  if (!envFlag(opts.env.CODEBERG_DBMCP_USE, false)) return { warnings };

  const exists = opts.io?.exists ?? existsSync;
  const cwd = opts.io?.cwd ?? process.cwd();
  const spec = resolveSpec(opts, exists, cwd);
  const bin = resolveBinary(opts, exists, cwd);
  if (!spec) {
    warnings.push(
      `database MCP is enabled but no spec file was found (${specHint(opts)}). Add spec.yml to the codeberg config directory.`,
    );
  }
  if (!bin) {
    const explicit = opts.env.CODEBERG_DBMCP_BIN?.trim();
    const where = explicit
      ? expandHome(explicit, opts.userHome)
      : 'build/dbmcp under the codeberg checkout';
    warnings.push(
      `database MCP is enabled but the dbmcp binary was not found (${where}). Run \`make build-dbmcp\` or set CODEBERG_DBMCP_BIN.`,
    );
  }
  if (!spec || !bin) return { warnings };

  return {
    warnings,
    server: {
      name: DBMCP_SERVER_NAME,
      kind: 'stdio',
      command: bin,
      args: ['-spec', spec],
      // Forward the agent env so spec ${VAR} placeholders expand in the child.
      env: stringEnv(opts.env),
    },
  };
}

function specHint(opts: BuiltinDatabaseOptions): string {
  const explicit = opts.env.CODEBERG_DBMCP_SPEC?.trim();
  if (explicit) return expandHome(explicit, opts.userHome);
  return SPEC_NAMES.map((name) => join(opts.home, name)).join(' or ');
}

function resolveSpec(
  opts: BuiltinDatabaseOptions,
  exists: (path: string) => boolean,
  cwd: string,
): string | undefined {
  const explicit = opts.env.CODEBERG_DBMCP_SPEC?.trim();
  if (explicit) {
    const expanded = expandHome(explicit, opts.userHome);
    const abs = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
    return exists(abs) ? abs : undefined;
  }
  for (const name of SPEC_NAMES) {
    const path = join(opts.home, name);
    if (exists(path)) return path;
  }
  return undefined;
}

function resolveBinary(
  opts: BuiltinDatabaseOptions,
  exists: (path: string) => boolean,
  cwd: string,
): string | undefined {
  const explicit = opts.env.CODEBERG_DBMCP_BIN?.trim();
  if (explicit) {
    const expanded = expandHome(explicit, opts.userHome);
    const abs = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
    return exists(abs) ? abs : undefined;
  }
  const starts = [cwd];
  const fromModule = moduleDir();
  if (fromModule) starts.push(fromModule);
  return findBuiltBinary(starts, exists);
}
