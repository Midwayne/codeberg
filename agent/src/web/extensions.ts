import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { discoverSkills, parseSkillDocument } from '../core/context/skills.js';
import { mcpConfigFromEnv, parseMcpJson } from '../core/mcp/config.js';
import { writeJsonAtomic } from '../core/learning/fs.js';
import { indexedRootsFromEnv } from '../core/paths.js';
import { readJson, sendJson, sendText } from './http.js';

export interface SkillFilePreview { filename: string; name?: string; description?: string; error?: string }
export function previewSkillFiles(input: unknown): SkillFilePreview[] {
  const files = (input as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > 20) throw new Error('Choose between 1 and 20 skill files.');
  const names = new Set<string>();
  return files.map((file: unknown) => {
    const value = file as { filename?: unknown; content?: unknown } | null;
    const filename = typeof value?.filename === 'string' ? basename(value.filename) : 'Unknown file';
    if (!/\.md$/i.test(filename)) return { filename, error: 'Choose Markdown (.md) skill files.' };
    if (typeof value?.content !== 'string' || Buffer.byteLength(value.content, 'utf8') > 256 * 1024) return { filename, error: 'Each skill file must be at most 256 KB.' };
    const fallback = filename.toLowerCase() === 'skill.md' ? '' : filename.replace(/\.md$/i, '');
    const parsed = parseSkillDocument(value.content, fallback);
    if (!parsed || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(parsed.name)) return { filename, error: 'Provide a skill name containing letters, numbers, dashes or underscores, and a description. SKILL.md needs a name in its frontmatter.' };
    if (names.has(parsed.name)) return { filename, error: 'Another selected skill has the same name. Import one file per skill.' };
    names.add(parsed.name);
    return { filename, ...parsed };
  });
}

/** Serialize the shared file separately from each project's file so two tabs
 * adding global MCP servers cannot silently overwrite each other's changes. */
export class ExtensionStore {
  private writes: Promise<unknown> = Promise.resolve();
  revision = 0;
  constructor(private readonly home: string) {}

  add(projectHome: string, input: unknown, env: NodeJS.ProcessEnv = process.env): Promise<void> {
    const next = this.writes.catch(() => undefined).then(() => this.write(projectHome, input, env));
    this.writes = next;
    return next;
  }
  private async write(projectHome: string, input: unknown, env: NodeJS.ProcessEnv) {
    const body = input as { scope?: unknown; kind?: unknown; name?: unknown; config?: unknown; content?: unknown } | null;
    if (!body || !['global', 'project'].includes(String(body.scope)) || !['mcp', 'skill'].includes(String(body.kind)) ||
      typeof body.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.name)) throw new Error('Choose a scope, kind and a name containing letters, numbers, dashes or underscores.');
    const root = body.scope === 'global' ? this.home : projectHome;
    if (body.kind === 'mcp') {
      const parsed = parseMcpJson(JSON.stringify({ mcpServers: { [body.name]: body.config } }), {
        env, userHome: homedir(), workspaceFolder: indexedRootsFromEnv(env)[0] ?? process.cwd(),
      }, { configDir: root });
      if (parsed.warnings.length || parsed.servers.length !== 1) throw new Error(parsed.warnings.join('; ') || 'Provide an enabled MCP server with a command or URL.');
      const file = join(root, 'mcp.json');
      const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return '{}';
      });
      const config = JSON.parse(text);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Existing MCP configuration must be an object.');
      if (Object.hasOwn(config.mcpServers ?? {}, body.name) || Object.hasOwn(config.servers ?? {}, body.name)) throw new Error('An MCP server with this name already exists in this scope.');
      config.mcpServers = { ...config.mcpServers, [body.name]: body.config };
      await writeJsonAtomic(file, config);
    } else {
      if (typeof body.content !== 'string' || Buffer.byteLength(body.content, 'utf8') > 256 * 1024) throw new Error('Provide a SKILL.md document up to 256 KB.');
      const parsed = parseSkillDocument(body.content, body.name);
      if (!parsed || parsed.name !== body.name) throw new Error('The skill document needs a description and its name must match.');
      const dir = join(root, 'skills', body.name);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      try { await writeFile(join(dir, 'SKILL.md'), body.content, { encoding: 'utf8', flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A skill with this name already exists in this scope.');
        throw error;
      }
    }
    this.revision++;
  }

  async route(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv) {
    if (new URL(req.url ?? '/', 'http://localhost').pathname === '/api/extensions/skills/preview') {
      if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
      if (!req.headers['content-type']?.startsWith('application/json')) return sendText(res, 415, 'application/json required');
      try { return sendJson(res, 200, { files: previewSkillFiles(await readJson(req)) }); }
      catch (error) { return sendText(res, 400, error instanceof Error ? error.message : 'Could not preview skill files'); }
    }
    if (req.method === 'GET') {
      const mcp = mcpConfigFromEnv(env);
      const skills = await discoverSkills({ env });
      return sendJson(res, 200, {
        mcps: await Promise.all(mcp.servers.map(async ({ name, kind }) => {
          let scope = name === 'databases' ? 'project' : 'global';
          for (const file of mcp.files) {
            let parsed: Record<string, unknown>;
            try { parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>; } catch { continue; }
            if (!parsed || typeof parsed !== 'object') continue;
            if (Object.hasOwn((parsed.mcpServers ?? {}) as object, name) || Object.hasOwn((parsed.servers ?? {}) as object, name)) {
              scope = file.startsWith(`${env.CODEBERG_PROJECT_HOME}/`) ? 'project' :
                file.startsWith(`${this.home}/`) ? 'global' : 'repository';
            }
          }
          return { name, kind, scope };
        })),
        skills: skills.map(({ name, description, file }) => ({ name, description,
          scope: file.startsWith(`${env.CODEBERG_PROJECT_HOME}/`) ? 'project' :
            (env.CODEBERG_ROOTS ?? '').split('\n').some((line) => file.startsWith(`${line.slice(line.indexOf('\t') + 1)}/`)) ? 'repository' : 'global',
        })), warnings: mcp.warnings,
      });
    }
    if (req.method !== 'POST') return sendText(res, 405, 'method not allowed');
    if (!req.headers['content-type']?.startsWith('application/json')) return sendText(res, 415, 'application/json required');
    try {
      await this.add(env.CODEBERG_PROJECT_HOME!, await readJson(req), env);
      return sendJson(res, 201, { ok: true });
    } catch (error) { return sendText(res, 400, error instanceof Error ? error.message : 'Could not add extension'); }
  }
}
