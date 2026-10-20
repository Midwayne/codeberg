import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { ContextStore } from './store.js';
import { contextTools } from './tools.js';

type Execute = (input: Record<string, unknown>, options: unknown) => Promise<string>;

it('reads, greps, and tails a 50 MiB result, but rejects a larger file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cberg-context-size-'));

  try {
    const store = ContextStore.open(root);
    const file = join(root, 'large-output.txt');
    const size = 50 * 1024 * 1024;
    const ending = '\nend-of-large-result';

    // Real text with bounded line lengths exercises the shared reader through
    // every context tool, including matches at the very end of the size limit.
    const content = Buffer.alloc(size, `${'x'.repeat(1023)}\n`);
    content.write('start-of-large-result\n', 0);
    content.write(ending, size - Buffer.byteLength(ending));
    writeFileSync(file, content);

    const tools = contextTools(store);
    const read = tools.context_read!.execute as Execute;
    const grep = tools.context_grep!.execute as Execute;
    const tail = tools.context_tail!.execute as Execute;

    expect(await read({ path: file, start_line: 1, end_line: 1 }, {}))
      .toContain('1|start-of-large-result');
    expect(await grep({ path: file, pattern: 'end-of-large-result' }, {}))
      .toContain('end-of-large-result');
    expect(await tail({ path: file, lines: 1 }, {}))
      .toContain('|end-of-large-result');

    appendFileSync(file, 'x');

    expect(await read({ path: file, start_line: 1, end_line: 1 }, {}))
      .toContain('too large');
    expect(await grep({ path: file, pattern: 'end-of-large-result' }, {}))
      .toContain('skipped (unreadable or too large)');
    expect(await tail({ path: file, lines: 1 }, {}))
      .toContain('too large');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
