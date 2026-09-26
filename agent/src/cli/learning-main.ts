#!/usr/bin/env node
import { join } from 'node:path';

import { exportDataset, type ExportType } from '../core/learning/export.js';
import { writeAtomic } from '../core/learning/fs.js';
import { LearningStore, defaultLearningRoot } from '../core/learning/store.js';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const store = new LearningStore();
  switch (command) {
    case 'search-learning':
      console.log(JSON.stringify(await store.searchLearning(args.join(' ')), null, 2));
      return;
    case 'search-knowledge':
      console.log(JSON.stringify(await store.searchKnowledge(args.join(' ')), null, 2));
      return;
    case 'list':
      console.log(JSON.stringify(await store.attempts(), null, 2));
      return;
    case 'show': {
      const interaction = await store.interaction(args[0] ?? '');
      console.log(JSON.stringify(interaction, null, 2));
      return;
    }
    case 'stats':
      console.log(JSON.stringify(await store.stats(), null, 2));
      return;
    case 'export': {
      const type = readExportType(args);
      const records = await exportDataset(store, type);
      const dir = join(defaultLearningRoot(), 'datasets', type);
      const path = join(dir, `${new Date().toISOString().replaceAll(':', '-')}.jsonl`);
      await writeAtomic(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
      console.log(path);
      return;
    }
    default:
      console.error('Usage: codeberg-learning search-learning <query> | search-knowledge <query> | list | show <interaction-id> | stats | export --type eval|embedding|openai-chat|query-positive-negative|preference|knowledge');
      process.exitCode = 1;
  }
}

function readExportType(args: string[]): ExportType {
  const index = args.indexOf('--type');
  const type = index >= 0 ? args[index + 1] : undefined;
  if (!['eval', 'embedding', 'openai-chat', 'query-positive-negative', 'preference', 'knowledge'].includes(type ?? '')) {
    throw new Error('--type must be eval, embedding, openai-chat, query-positive-negative, preference, or knowledge');
  }
  return type as ExportType;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
