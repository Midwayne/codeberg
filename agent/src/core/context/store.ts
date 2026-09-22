import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { codebergHome } from '../paths.js';
import { toolOutputText } from '../message.js';

/** Context files for one user (`$CODEBERG_HOME/context`). Stable across runs so
 *  a resumed chat can still open the history file named in its summary. */
export function defaultContextRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(codebergHome(env), 'context');
}

/**
 * On-disk dynamic context: history transcripts, spilled tool output, MCP
 * catalogs, and terminal logs. Readers must go through `resolve`, which
 * refuses paths outside the context root and any extra roots passed to
 * `allow` (skill directories).
 */
export class ContextStore {
  private readonly extra: string[] = [];

  private constructor(readonly root: string) {}

  static open(root: string): ContextStore {
    mkdirSync(root, { recursive: true });
    return new ContextStore(root);
  }

  /** Permit reads under `root` (a skill directory, for example). */
  allow(root: string): void {
    if (!root) return;
    this.extra.push(resolve(root));
  }

  /**
   * Absolute path for `requested` if it exists and stays inside an allowed
   * root after symlink resolution. Relative paths are resolved against the
   * context root.
   */
  resolve(requested: string): string | null {
    if (!requested || requested.includes('\0')) return null;
    const candidate = isAbsolute(requested) ? resolve(requested) : resolve(this.root, requested);
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      return null;
    }
    for (const root of this.realRoots()) {
      if (contains(root, real)) return real;
    }
    return null;
  }

  /** Write `body` at a relative path inside the context root. Returns the
   *  absolute path. */
  async writeRel(rel: string, body: string): Promise<string> {
    const abs = join(this.root, safeRel(rel));
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body, 'utf8');
    return abs;
  }

  /** Content-addressed transcript. The same text always maps to the same file. */
  async writeHistory(transcript: string): Promise<string> {
    return this.writeRel(join('history', `${contentHash(transcript)}.txt`), transcript);
  }

  /**
   * Full tool output the model was not shown inline. The path is a hash of
   * the body, so the same output is one file. `tools/INDEX.txt` gains a line
   * only when that file is created.
   */
  async writeToolOutput(toolName: string, body: string): Promise<string> {
    const rel = join('tools', `${safeSegment(toolName)}-${contentHash(body)}.txt`);
    const abs = join(this.root, safeRel(rel));
    await mkdir(join(abs, '..'), { recursive: true });
    try {
      await writeFile(abs, body, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if (isAlreadyExists(err)) return abs;
      throw err;
    }
    await appendFile(join(this.root, 'tools', 'INDEX.txt'), `${toolName}\t${abs}\n`, 'utf8');
    return abs;
  }

  /** Append one command's output to that tool's session log. */
  async appendTerminal(toolName: string, args: unknown, output: string): Promise<string> {
    const rel = join('terminals', `${safeSegment(toolName)}.log`);
    const abs = join(this.root, safeRel(rel));
    await mkdir(join(abs, '..'), { recursive: true });
    const argsText = toolOutputText(args).replace(/\s+/g, ' ').slice(0, 500);
    const entry = `===== ${new Date().toISOString()} ${toolName} =====\n$ ${argsText}\n${output}\n`;
    await appendFile(abs, entry, 'utf8');
    return abs;
  }

  private realRoots(): string[] {
    const out: string[] = [];
    for (const root of [this.root, ...this.extra]) {
      try {
        out.push(realpathSync(root));
      } catch {
        // The directory may not exist yet; skip until it does.
      }
    }
    return out;
  }
}

/** One path segment safe to use as a file or directory name. */
export function safeSegment(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'item';
}

function safeRel(rel: string): string {
  if (!rel || rel.includes('\0') || isAbsolute(rel)) {
    throw new Error(`invalid context path: ${rel}`);
  }
  const parts = rel.split(/[/\\]/).filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) {
    throw new Error(`invalid context path: ${rel}`);
  }
  return parts.join(sep);
}

export function contentHash(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}

function isAlreadyExists(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'EEXIST'
  );
}

function contains(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
