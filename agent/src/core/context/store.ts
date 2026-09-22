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
  private toolSeq = 0;

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
    const hash = createHash('sha256').update(transcript).digest('hex').slice(0, 16);
    return this.writeRel(join('history', `${hash}.txt`), transcript);
  }

  /** Full tool output the model was not shown inline. Also appends a line to
   *  `tools/INDEX.txt` so a later turn can find the file after the preview is pruned. */
  async writeToolOutput(toolName: string, body: string): Promise<string> {
    this.toolSeq += 1;
    const abs = await this.writeRel(join('tools', `${safeSegment(toolName)}-${this.toolSeq}.txt`), body);
    const index = join(this.root, 'tools', 'INDEX.txt');
    await appendFile(index, `${toolName}\t${abs}\n`, 'utf8');
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

function contains(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
