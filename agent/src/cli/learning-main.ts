#!/usr/bin/env node
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { DatasetStore, type Provenance } from '../core/learning/datasets.js';
import { historicalEvalMetrics, scoreRetrievalRuns, type RetrievalRun } from '../core/learning/metrics.js';
import { exportDataset, type ExportType } from '../core/learning/export.js';
import { writeAtomic } from '../core/learning/fs.js';
import { LearningStore, defaultLearningRoot } from '../core/learning/store.js';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const store = new LearningStore();
  const datasets = new DatasetStore(store);
  switch (command) {
    case 'search-learning':
      console.log(JSON.stringify(await store.searchLearning(args.join(' ')), null, 2));
      return;
    case 'search-knowledge':
      console.log(JSON.stringify(await store.searchKnowledge(args.filter((arg) => arg !== '--all').join(' '), 10,
        { includeUnverified: args.includes('--all') }), null, 2));
      return;
    case 'list-knowledge':
      console.log(JSON.stringify(await store.knowledgeArtifacts(), null, 2));
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
    case 'metrics':
      console.log(JSON.stringify(await historicalEvalMetrics(store), null, 2));
      return;
    case 'score': {
      if (!args[0]) throw new Error('score requires a JSONL file of {eval_id,hits,tool_calls,retrieved_tokens,latency_ms,success}');
      const records = (await readFile(args[0], 'utf8')).split('\n').filter((line) => line.trim())
        .map((line) => JSON.parse(line) as RetrievalRun);
      console.log(JSON.stringify(scoreRetrievalRuns(await datasets.active('eval'), records), null, 2));
      return;
    }
    case 'candidates':
      console.log(JSON.stringify(await datasets.list('candidates'), null, 2));
      return;
    case 'extract':
      if (!args[0]) throw new Error('extract requires an interaction ID');
      console.log(JSON.stringify(await datasets.extract(args[0]), null, 2));
      return;
    case 'promote': {
      const [id, split, provenance, oracleFile] = args;
      if (!id || (split !== 'eval' && split !== 'training') || !provenance) {
        throw new Error('Usage: promote <example-id> <eval|training> <provenance> [oracle.json]');
      }
      const oracle = oracleFile ? JSON.parse(await readFile(oracleFile, 'utf8')) as Record<string, unknown> : undefined;
      console.log(JSON.stringify(await datasets.promote(id, split, { provenance: provenance as Provenance, oracle }), null, 2));
      return;
    }
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
       console.error('Usage: codeberg-learning search-learning <query> | search-knowledge [--all] <query> | list-knowledge | list | show <interaction-id> | stats | metrics | score <runs.jsonl> | candidates | extract <interaction-id> | promote <example-id> <eval|training> <provenance> [oracle.json] | export --type eval|embedding|openai-chat|query-positive-negative|preference|knowledge');
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
