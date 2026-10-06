#!/usr/bin/env node
import { join } from 'node:path';
import { createAgentFromEntry } from '../core/config.js';
import { entryUsage, parseEntryArgs } from '../core/entry.js';
import { withProjectLog } from '../core/module-log.js';
import { codebergHome } from '../core/paths.js';
import { ChatSession } from '../core/session.js';
import { printResult } from './format.js';

import { currentProjectEnvironment, prepareProjectStorage } from '../core/projects.js';

async function main(): Promise<void> {
  await prepareProjectStorage();
  const entry = parseEntryArgs(process.argv);
  if (!entry?.question) {
    console.error(entryUsage('codeberg-ask'));
    process.exit(1);
  }

  process.env.CODEBERG_LOG_DIR ??= join(codebergHome(), 'logs');

  await withProjectLog(
    currentProjectEnvironment().CODEBERG_LOG_DIR ?? process.env.CODEBERG_LOG_DIR!,
    async () => {
      const agent = createAgentFromEntry(entry);
      try {
        const session = new ChatSession({ agent });
        const result = await session.ask(entry.question);
        printResult(result);
      } finally {
        await agent.close();
      }
    },
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
