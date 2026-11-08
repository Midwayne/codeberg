#!/usr/bin/env node
import { createAgentFromEntry } from '../core/config.js';
import { entryUsage, parseEntryArgs } from '../core/entry.js';
import { withProjectLog } from '../core/module-log.js';
import { ChatSession } from '../core/session.js';
import { cliProjectEnvironment } from './bootstrap.js';
import { printResult } from './format.js';

async function main(): Promise<void> {
  const env = await cliProjectEnvironment();
  const entry = parseEntryArgs(process.argv, env);
  if (!entry?.question) {
    console.error(entryUsage('codeberg-ask'));
    process.exit(1);
  }

  await withProjectLog(env.CODEBERG_LOG_DIR ?? process.env.CODEBERG_LOG_DIR!, async () => {
    const agent = createAgentFromEntry(entry, env);
    try {
      const session = new ChatSession({ agent });
      const result = await session.ask(entry.question);
      printResult(result);
    } finally {
      await agent.close();
    }
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
