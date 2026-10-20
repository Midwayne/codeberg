import { readFile } from 'node:fs/promises';

import { fromAiSdk } from '../core/generator.js';
import { DatasetStore } from '../core/learning/datasets.js';
import { judgeScorers } from '../core/learning/evaluation/judge.js';
import { evaluateOutputs } from '../core/learning/evaluation/runner.js';
import { outputScorers } from '../core/learning/evaluation/scorers.js';
import type { OutputRun } from '../core/learning/evaluation/types.js';
import type { LearningStore } from '../core/learning/store.js';
import { defaultProviders } from '../providers/index.js';

/** Import candidate runs locally; model calls require an explicit --judge selection. */
export async function scoreOutputsFile(store: LearningStore, args: string[]): Promise<void> {
  const [path, flag, model, ...extra] = args;
  if (
    !path ||
    path.startsWith('--') ||
    extra.length ||
    (flag !== undefined && (flag !== '--judge' || !model?.includes(':'))) ||
    (flag === undefined && model !== undefined)
  ) {
    throw new Error('Usage: score-outputs <runs.jsonl> [--judge provider:model]');
  }

  const runs = (await readFile(path, 'utf8'))
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as OutputRun);
  const examples = await new DatasetStore(store).active('eval');
  const scorers = outputScorers();
  if (model)
    scorers.push(
      ...judgeScorers(fromAiSdk(defaultProviders().resolve(model), undefined, model), model),
    );

  const report = await evaluateOutputs(examples, runs, scorers);
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report.summary).some((summary) => summary.errors)) process.exitCode = 1;
}
