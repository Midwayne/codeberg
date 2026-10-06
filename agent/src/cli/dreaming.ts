import { DurableJobQueue, classifyFailure } from '../core/learning/queue.js';
import { randomUUID } from 'node:crypto';
import { defaultProviders } from '../providers/index.js';
import { reasoningFromEnv } from '../core/config.js';
import { fromAiSdk } from '../core/generator.js';
import { DreamingConsolidator } from '../core/learning/dreaming/consolidator.js';
import { DreamingReports } from '../core/learning/dreaming/reports.js';
import { LearningSettingsStore } from '../core/learning/settings.js';
import type { LearningStore } from '../core/learning/store.js';
import type { DreamingDecision } from '../core/learning/dreaming/types.js';

/** Offline inspection/decisions need no model; only planning resolves provider credentials. */
export async function dreamingCommand(command: string, args: string[], store: LearningStore): Promise<unknown> {
  const reports = new DreamingReports(store.root);
  if (command === 'dream-reports') return reports.list();
  if (command === 'dream-report') return await reports.get(args[0] ?? '') ?? null;
  const settings = await new LearningSettingsStore(store.root).current();
  if (!settings.enabled || !settings.knowledge) throw new Error('Knowledge consolidation is paused.');
  if (command === 'dream') {
    const spec = process.env.CODEBERG_SUBAGENT_MODEL ?? process.env.CODEBERG_MODEL;
    if (!spec?.includes(':')) throw new Error('Set CODEBERG_SUBAGENT_MODEL or CODEBERG_MODEL to provider:model to generate a report.');
    const generator = fromAiSdk(defaultProviders().resolve(spec), reasoningFromEnv(), spec);
    const queue = new DurableJobQueue(store.root);
    await queue.reconcileStates(); await queue.recoverExpired();
    const id = `dream-${randomUUID()}`;
    const job = await queue.enqueueDreaming(id);
    const claimed = await queue.claim('consolidate_knowledge', (pending) => pending.job_id === job.job_id);
    if (!claimed) return { job }; // Another running Codeberg process owns this request.
    try {
      const report = await new DreamingConsolidator(store, reports, generator, () => settings.categories).plan(id);
      await queue.complete(claimed);
      return report;
    } catch (error) {
      await queue.fail(claimed, classifyFailure(error), String(error));
      throw error;
    }
  }
  if (!args[0]) throw new Error(`${command} requires a report ID`);
  const report = await reports.get(args[0]);
  if (command === 'dream-apply' && report?.changes.some((change) => !settings.categories[change.before.category])) throw new Error('A report category is paused.');
  return reports.decide(args[0], command.slice('dream-'.length) as DreamingDecision, store);
}
