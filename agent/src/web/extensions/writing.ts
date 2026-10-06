import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSkillDocument } from '../../core/context/skills.js';
import { writeJsonAtomic } from '../../core/learning/fs.js';
import { parseMcpJson } from '../../core/mcp/config.js';
import { indexedRootsFromEnv } from '../../core/paths.js';
import type { ExtensionStoreState } from './state.js';

export function add(
  state: ExtensionStoreState,
  projectHome: string,
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const next = state.writes
    .catch(() => undefined)
    .then(() => write(state, projectHome, input, env));
  state.writes = next;

  return next;
}

export async function write(
  state: ExtensionStoreState,
  projectHome: string,
  input: unknown,
  env: NodeJS.ProcessEnv,
) {
  const body = input as {
    scope?: unknown;
    kind?: unknown;
    name?: unknown;
    config?: unknown;
    content?: unknown;
  } | null;

  if (
    !body ||
    !['global', 'project'].includes(String(body.scope)) ||
    !['mcp', 'skill'].includes(String(body.kind)) ||
    typeof body.name !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.name)
  )
    throw new Error(
      'Choose a scope, kind and a name containing letters, numbers, dashes or underscores.',
    );

  const extension = { ...body, name: body.name };
  const root = body.scope === 'global' ? state.home : projectHome;
  if (body.kind === 'mcp') {
    await writeMcp(root, extension, env);
  } else {
    await writeSkill(root, extension);
  }

  state.revision++;
}

async function writeMcp(root: string, body: ExtensionInput, env: NodeJS.ProcessEnv): Promise<void> {
  const parsed = parseMcpJson(
    JSON.stringify({ mcpServers: { [body.name]: body.config } }),
    {
      env,
      userHome: homedir(),
      workspaceFolder: indexedRootsFromEnv(env)[0] ?? process.cwd(),
    },
    { configDir: root },
  );

  if (parsed.warnings.length || parsed.servers.length !== 1)
    throw new Error(
      parsed.warnings.join('; ') || 'Provide an enabled MCP server with a command or URL.',
    );

  const file = join(root, 'mcp.json');
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;

    return '{}';
  });

  const config = JSON.parse(text);
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Existing MCP configuration must be an object.');

  if (
    Object.hasOwn(config.mcpServers ?? {}, body.name) ||
    Object.hasOwn(config.servers ?? {}, body.name)
  )
    throw new Error('An MCP server with this name already exists in this scope.');

  config.mcpServers = { ...config.mcpServers, [body.name]: body.config };
  await writeJsonAtomic(file, config);
}

async function writeSkill(root: string, body: ExtensionInput): Promise<void> {
  if (typeof body.content !== 'string' || Buffer.byteLength(body.content, 'utf8') > 256 * 1024)
    throw new Error('Provide a SKILL.md document up to 256 KB.');

  const parsed = parseSkillDocument(body.content, body.name);
  if (!parsed || parsed.name !== body.name)
    throw new Error('The skill document needs a description and its name must match.');

  const dir = join(root, 'skills', body.name);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(dir, 'SKILL.md'), body.content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('A skill with this name already exists in this scope.');

    throw error;
  }
}

interface ExtensionInput {
  scope?: unknown;
  kind?: unknown;
  name: string;
  config?: unknown;
  content?: unknown;
}
