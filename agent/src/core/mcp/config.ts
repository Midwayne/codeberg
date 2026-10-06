import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultExists, defaultReadFile } from './config/io.js';
import { parseMcpJson } from './config/parse.js';
import { expandHome, flag, splitList } from './config/values.js';

import { findGitRoot, indexedRootsFromEnv } from '../paths.js';
import { builtinDatabaseServer } from './builtin.js';
import type { McpConfig, McpConfigIo, McpInterpolateContext, McpServer } from './types.js';

export { indexedRootsFromEnv };

const MCP_FILE = 'mcp.json';

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
    home: env.CODEBERG_PROJECT_HOME ?? home,
    userHome,
    io: { ...io, cwd, exists },
  });

  warnings.push(...builtin.warnings);
  if (builtin.server) merged[builtin.server.name] = builtin.server;

  const files: string[] = [];
  if (userEnabled) {
    const discovered = userMcpFiles(env, home, userHome, cwd, exists);
    files.push(...discovered.files);

    for (const file of files) {
      loadMcpFile(file, env, userHome, discovered.workspace, readFile, merged, warnings);
    }
  }

  return {
    enabled: true,
    servers: Object.values(merged),
    files,
    warnings,
  };
}

function userMcpFiles(
  env: NodeJS.ProcessEnv,
  home: string,
  userHome: string,
  cwd: string,
  exists: (path: string) => boolean,
) {
  const roots = indexedRootsFromEnv(env);
  const extra = splitList(env.CODEBERG_MCP_CONFIG ?? '').map((p) => expandHome(p, userHome));
  const files = discoverMcpConfigPaths({ home, roots, cwd, extra, exists });
  const projectFile = env.CODEBERG_PROJECT_HOME && join(env.CODEBERG_PROJECT_HOME, MCP_FILE);
  if (projectFile && exists(projectFile)) files.push(projectFile);

  return { files, workspace: roots[0] ?? cwd };
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
    merged[server.name] =
      server.kind === 'stdio' && env.CODEBERG_PROJECT_HOME && !server.cwd
        ? { ...server, cwd: fallbackWorkspace }
        : server;
  }
}

export { interpolateMcpString } from './config/values.js';

export type { ParseMcpJsonOptions } from './config/types.js';

export { parseMcpJson } from './config/parse.js';

export { defaultReadFile } from './config/io.js';
