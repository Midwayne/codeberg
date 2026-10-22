import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import { DEFAULT_DAEMON_URL } from '../client.js';
import { createAgent } from '../config.js';
import { toolJournal } from '../runs/tools.js';

interface Task {
  id: string;
  question: string;
  expectedPaths: { repo: string; path: string }[];
  answerIncludes: string[];
  repositories: { key: string; root: string; commit: string }[];
}

const taskFile = process.env.CODEBERG_BUNDLE_EVAL_TASKS;

it.skipIf(!taskFile)('compares full-agent task success, provider tokens, and latency on pinned held-out searches', async () => {
  const modelSpec = process.env.CODEBERG_MODEL;
  const reportPath = process.env.CODEBERG_BUNDLE_EVAL_REPORT;
  if (!modelSpec || !reportPath) throw new Error('CODEBERG_MODEL and CODEBERG_BUNDLE_EVAL_REPORT are required.');

  const tasks: Task[] = (await readFile(taskFile!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const root = await mkdtemp(join(tmpdir(), 'codeberg-bundle-eval-'));
  const rows: Record<string, unknown>[] = [];
  try {
    for (const task of tasks) {
      validateTask(task);
      for (let trial = 0; trial < 5; trial++) {
        for (const enabled of trial % 2 ? [true, false] : [false, true]) {
          rows.push(await attempt(task, trial, enabled, modelSpec, root));
          await writeFile(reportPath, JSON.stringify({ model: modelSpec, tasks: tasks.length, rows }, null, 2));
        }
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  // Coverage and per-arm success must be inspected together; absence is never a passing score.
  expect(rows).toHaveLength(tasks.length * 10);
}, 3_600_000);

function validateTask(task: Task) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(task.id) || !task.question || !task.expectedPaths?.length || !task.answerIncludes?.length
    || !task.repositories?.length) throw new Error('Each held-out task needs repositories, source oracles, and answer anchors.');

  for (const repo of task.repositories) {
    const commit = execFileSync('git', ['-C', repo.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', repo.root, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (commit !== repo.commit || dirty) throw new Error(`Restore the clean pinned commit for ${repo.key} before evaluation.`);
  }
}

async function attempt(task: Task, trial: number, enabled: boolean, modelSpec: string, root: string) {
  const meter = { inputTokens: 0, outputTokens: 0, providerRequests: 0, missingUsage: 0 };
  const toolNames: string[] = [];
  const agent = createAgent({
    modelSpec,
    daemonUrl: process.env.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL,
    learning: false,
    env: { ...process.env, CODEBERG_HOME: join(root, `${task.id}-${trial}-${enabled}`),
      CODEBERG_ROOTS: task.repositories.map((repo) => `${repo.key}\t${repo.root}`).join('\n'),
      CODEBERG_SEARCH_BUNDLE_USE: String(enabled), CODEBERG_MCP_USE: 'false', CODEBERG_WEB_USE: 'false',
      CODEBERG_CANVAS_USE: 'false' },
    transformModel: (model) => measured(model, meter),
  });
  const started = performance.now();
  try {
    const result = await toolJournal.run({ pending: new Set(), append: async (entry) => {
      if (entry.state === 'started') toolNames.push(entry.name);
    } }, () => agent.ask(task.question));
    const hits = task.expectedPaths.filter(({ repo, path }) => result.sources.some((hit) => hit.repo === repo && hit.path === path)
      && result.answer.includes(path));
    const anchors = task.answerIncludes.every((text) => result.answer.includes(text));

    return { taskId: task.id, trial, enabled, success: hits.length === task.expectedPaths.length && anchors,
      expectedFileRecall: hits.length / task.expectedPaths.length, answerAnchors: anchors,
      latencyMs: performance.now() - started, ...meter, toolCalls: toolNames.length,
      bundleCalls: toolNames.filter((name) => name === 'search_bundle').length };
  } catch (error) {
    return { taskId: task.id, trial, enabled, success: false, error: String(error),
      latencyMs: performance.now() - started, ...meter };
  } finally {
    await agent.close();
  }
}

function measured(model: LanguageModel, meter: { inputTokens: number; outputTokens: number; providerRequests: number; missingUsage: number }) {
  if (typeof model === 'string') throw new Error('Evaluation needs a resolved model.');

  return wrapLanguageModel({ model, middleware: { specificationVersion: 'v4', wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate();
    meter.providerRequests++;
    if (result.usage.inputTokens.total === undefined || result.usage.outputTokens.total === undefined) meter.missingUsage++;
    meter.inputTokens += result.usage.inputTokens.total ?? 0;
    meter.outputTokens += result.usage.outputTokens.total ?? 0;

    return result;
  } } });
}
