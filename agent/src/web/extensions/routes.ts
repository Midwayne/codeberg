import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { discoverSkills } from '../../core/context/skills.js';
import { mcpConfigFromEnv } from '../../core/mcp/config.js';
import { readJson, sendJson, sendText } from '../http.js';
import { previewSkillFiles } from './preview.js';
import type { ExtensionStoreState } from './state.js';
import { add } from './writing.js';

export async function route(
  state: ExtensionStoreState,
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv,
) {
  if (new URL(req.url ?? '/', 'http://localhost').pathname === '/api/extensions/skills/preview') {
    if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

    if (!req.headers['content-type']?.startsWith('application/json'))
      return sendText(res, 415, 'application/json required');

    try {
      return sendJson(res, 200, { files: previewSkillFiles(await readJson(req)) });
    } catch (error) {
      return sendText(
        res,
        400,
        error instanceof Error ? error.message : 'Could not preview skill files',
      );
    }
  }

  if (req.method === 'GET') {
    return sendJson(res, 200, await listExtensions(state, env));
  }

  if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');

  if (!req.headers['content-type']?.startsWith('application/json'))
    return sendText(res, 415, 'application/json required');

  try {
    await add(state, env.CODEBERG_PROJECT_HOME!, await readJson(req), env);

    return sendJson(res, 201, { ok: true });
  } catch (error) {
    return sendText(res, 400, error instanceof Error ? error.message : 'Could not add extension');
  }
}

async function listExtensions(state: ExtensionStoreState, env: NodeJS.ProcessEnv) {
  const mcp = mcpConfigFromEnv(env);
  const skills = await discoverSkills({ env });

  return {
    mcps: await Promise.all(
      mcp.servers.map(async ({ name, kind }) => {
        return { name, kind, scope: await mcpScope(name, mcp.files, state.home, env) };
      }),
    ),
    skills: skills.map(({ name, description, file }) => ({
      name,
      description,
      scope: file.startsWith(`${env.CODEBERG_PROJECT_HOME}/`)
        ? 'project'
        : (env.CODEBERG_ROOTS ?? '')
              .split('\n')
              .some((line) => file.startsWith(`${line.slice(line.indexOf('\t') + 1)}/`))
          ? 'repository'
          : 'global',
    })),
    warnings: mcp.warnings,
  };
}

async function mcpScope(
  name: string,
  files: string[],
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  let scope = name === 'databases' ? 'project' : 'global';
  for (const file of files) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    if (
      Object.hasOwn((parsed.mcpServers ?? {}) as object, name) ||
      Object.hasOwn((parsed.servers ?? {}) as object, name)
    ) {
      scope = file.startsWith(`${env.CODEBERG_PROJECT_HOME}/`)
        ? 'project'
        : file.startsWith(`${home}/`)
          ? 'global'
          : 'repository';
    }
  }

  return scope;
}
