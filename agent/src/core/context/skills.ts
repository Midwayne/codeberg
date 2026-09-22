import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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
  for (const root of [...userRoots, ...projectDirs]) {
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

/** Parse a SKILL.md. Returns null when it has no usable name and description. */
export function parseSkillDocument(
  text: string,
  fallbackName: string,
): { name: string; description: string } | null {
  const { fields, body } = parseFrontmatter(text);
  const name = (fields.get('name') || fallbackName).trim();
  let description = (fields.get('description') || '').trim();
  if (!description) {
    description = firstParagraph(body);
  }
  if (!name || !description) return null;
  return { name, description };
}

function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const line = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .join(' ');
    if (line) return line.replace(/\s+/g, ' ').slice(0, 500);
  }
  return '';
}

function parseFrontmatter(text: string): { fields: Map<string, string>; body: string } {
  const normalized = text.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== '---') {
    return { fields: new Map(), body: text };
  }
  const fields = new Map<string, string>();
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') {
      i++;
      break;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2] ?? '';
    if (value === '>' || value === '|' || value === '') {
      const folded: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j] ?? '';
        if (next.trim() === '---') break;
        if (/^[A-Za-z0-9_-]+:\s*/.test(next)) break;
        if (next === '' || next.startsWith(' ') || next.startsWith('\t')) {
          folded.push(next.trim());
          continue;
        }
        break;
      }
      if (folded.length > 0) {
        const joiner = value === '|' ? '\n' : ' ';
        value = folded.filter(Boolean).join(joiner);
        i = j - 1;
      }
    } else {
      value = unquote(value.trim());
    }
    fields.set(key, value);
  }
  return { fields, body: lines.slice(i).join('\n') };
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
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
