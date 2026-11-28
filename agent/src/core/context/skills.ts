import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseSkillDocument } from './skill-document.js';

import { codebergHome } from '../paths.js';
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

interface DiscoverSkillsOptions {
  env?: NodeJS.ProcessEnv;
  /** Skill roots, later ones overriding the same name. Defaults to
   *  ~/.agents/skills, then $CODEBERG_HOME/skills (~/.codeberg/skills). */
  userRoots?: readonly string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
const MAX_DEPTH = 5;

/**
 * Find SKILL.md files in ~/.agents/skills and ~/.codeberg/skills only. A
 * skill in ~/.codeberg/skills overrides one of the same name in
 * ~/.agents/skills. Repositories and projects are not searched.
 */
export async function discoverSkills(opts: DiscoverSkillsOptions = {}): Promise<SkillSummary[]> {
  const env = opts.env ?? process.env;
  const roots = opts.userRoots ?? defaultUserSkillRoots(env);

  const byName = new Map<string, SkillSummary>();
  for (const root of roots) {
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

function defaultUserSkillRoots(env: NodeJS.ProcessEnv): string[] {
  return [join(env.HOME?.trim() || homedir(), '.agents', 'skills'), join(codebergHome(env), 'skills')];
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
