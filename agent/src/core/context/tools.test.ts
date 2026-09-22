import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ContextStore } from './store.js';
import { contextTools } from './tools.js';

function tempStore(): ContextStore {
  return ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-tools-')));
}

type Exec = (input: Record<string, unknown>, opts: unknown) => Promise<string>;

function execOf(tools: ReturnType<typeof contextTools>, name: keyof ReturnType<typeof contextTools>): Exec {
  return (tools[name] as { execute: Exec }).execute;
}

describe('context tools', () => {
  it('lists a directory, greps a file, and tails the end', async () => {
    const store = tempStore();
    await store.writeRel('mcp/github/list_issues.json', '{\n  "tool": "list_issues"\n}\n');
    await store.writeRel('history/abc.txt', ['one', 'token balance', 'three', 'four'].join('\n'));
    const tools = contextTools(store);

    const listing = await execOf(tools, 'context_read')({ path: 'mcp/github' }, {});
    expect(listing).toContain('list_issues.json');

    const grep = await execOf(tools, 'context_grep')({ pattern: 'balance', literal: true }, {});
    expect(grep).toContain('history');
    expect(grep).toContain('token balance');

    const tail = await execOf(tools, 'context_tail')({ path: 'history/abc.txt', lines: 2 }, {});
    expect(tail).toContain('3|three');
    expect(tail).toContain('4|four');
    expect(tail).not.toContain('token balance');
  });

  it('refuses a path outside the context root', async () => {
    const store = tempStore();
    const tools = contextTools(store);
    const result = await execOf(tools, 'context_read')({ path: '/etc/passwd' }, {});
    expect(result).toContain('not allowed');
  });

  it('can read an allowed skill file outside the context root', async () => {
    const store = tempStore();
    const skillDir = mkdtempSync(join(tmpdir(), 'cberg-skill-'));
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Review\n\nCheck the diff.\n');
    store.allow(skillDir);
    const tools = contextTools(store);
    const result = await execOf(tools, 'context_read')({ path: join(skillDir, 'SKILL.md') }, {});
    expect(result).toContain('Check the diff.');
  });
});
