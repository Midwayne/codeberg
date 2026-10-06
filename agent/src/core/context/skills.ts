import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseSkillDocument } from './skill-document.js';

import { codebergHome, projectRoots } from '../paths.js';
import type { ContextStore } from './store.js';

/** A discovered Agent Skill (SKILL.md). The prompt receives name and
 *  description only; the file itself is read on demand. */
export interface SkillSummary {
  name: string;
  description: string;
  /** Absolute path to SKILL.md. */
  file: string;
  /** Directory that holds SKILL.md and any bundled scripts. */
  dir: string;
}

export interface DiscoverSkillsOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** User-level skill roots, searched before project roots. Defaults to
   *  ~/.agents/skills, ~/.cursor/skills, and $CODEBERG_HOME/skills. */
  userRoots?: readonly string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
const MAX_DEPTH = 5;

/**
 * Find SKILL.md files. Later roots override the same skill name, and project
 * roots override user roots, so a repo skill wins over a global one.
 */
export async function discoverSkills(opts: DiscoverSkillsOptions = {}): Promise<SkillSummary[]> {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const userRoots = opts.userRoots ?? defaultUserSkillRoots(env);
  const projects = projectRoots(env, cwd);
  const projectDirs = projects.flatMap((root) => [
    join(root, '.agents', 'skills'),
    join(root, '.cursor', 'skills'),
    join(root, '.codeberg', 'skills'),
  ]);

  const byName = new Map<string, SkillSummary>();
  for (const root of [
    ...userRoots,
    ...projectDirs,
    ...(env.CODEBERG_PROJECT_HOME ? [join(env.CODEBERG_PROJECT_HOME, 'skills')] : []),
  ]) {
    const files = await findSkillFiles(root);
    for (const file of files) {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }

      const parsed = parseSkillDocument(text, dirname(file).split(/[/\\]/).pop() || '');
      if (!parsed) continue;

      byName.set(parsed.name, {
        name: parsed.name,
        description: parsed.description,
        file,
        dir: dirname(file),
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Discover skills, allow their directories, and write `skills/INDEX.md` when any exist. */
export async function publishSkills(
  store: ContextStore,
  opts: DiscoverSkillsOptions = {},
): Promise<SkillSummary[]> {
  const skills = await discoverSkills(opts);
  for (const skill of skills) {
    store.allow(skill.dir);
  }

  if (skills.length === 0) return skills;

  const index = skills
    .map((skill) => `## ${skill.name}\n${skill.description}\n${skill.file}\n`)
    .join('\n');
  await store.writeRel('skills/INDEX.md', index);

  return skills;
}

export function defaultUserSkillRoots(env: NodeJS.ProcessEnv): string[] {
  return [
    join(homedir(), '.agents', 'skills'),
    join(homedir(), '.cursor', 'skills'),
    join(codebergHome(env), 'skills'),
  ];
}

async function findSkillFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, 0, out);

  return out;
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, depth + 1, out);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      out.push(path);
    }
  }
}

export { parseSkillDocument } from './skill-document.js';
