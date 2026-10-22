import { closeBrowserSessions } from '../../core/browser/sessions.js';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { LearningService } from '../../core/learning/service.js';
import type { WebSessionStore } from '../sessions/store.js';
import { isValidSessionId } from '../sessions/records.js';
import { executeRun } from './execution.js';
import { RunJournal } from './journal.js';
import { recoverInterruptedRun } from './recovery.js';
import { saveRunSession } from './persistence.js';
import { notify, runStream } from './stream.js';
import { RunError, type ChatGenerator, type RunInput, type SearchRun } from './types.js';
import { validateHistory } from './validation.js';

/** One owner per project/chat. Completed calls are replayed as observations, never executed. */
export class SearchRuns {
  private readonly active = new Map<string, SearchRun>();
  private readonly admissions = new Map<string, Promise<unknown>>();
  private readonly loading = new Map<string, Promise<SearchRun | undefined>>();
  private initializing?: Promise<void>;
  private closed = false;

  constructor(readonly sessions: WebSessionStore, private readonly generate: ChatGenerator,
    private readonly options: { learning?: LearningService } = {}) {}

  get busy(): boolean {
    return this.active.size > 0 || this.admissions.size > 0;
  }

  initialize(): Promise<void> {
    this.initializing ??= this.recover();

    return this.initializing;
  }

  async admit(input: RunInput): Promise<SearchRun> {
    input = structuredClone(input);
    await this.initialize();
    const prior = this.admissions.get(input.chatId) ?? Promise.resolve();
    const pending = prior.catch(() => undefined).then(() => this.start(input));
    this.admissions.set(input.chatId, pending);
    try {
      return await pending;
    } finally {
      if (this.admissions.get(input.chatId) === pending) this.admissions.delete(input.chatId);
    }
  }

  async find(chatId: string, id?: string): Promise<SearchRun | undefined> {
    await this.initialize();
    id ??= (await this.sessions.load(chatId))?.serverRunId;
    if (!id || !isValidSessionId(chatId) || !isValidSessionId(id)) return undefined;

    const live = this.active.get(chatId);
    if (live?.record.id === id) return live;

    return this.load(join(this.sessions.dir, '.runs', chatId, id));
  }

  findRequest(chatId: string, requestId: string): Promise<SearchRun | undefined> {
    return this.find(chatId, hash(`${chatId}:${requestId}`).slice(0, 32));
  }

  stream(run: SearchRun, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0 || after > run.events.length) {
      throw new RunError(400, 'invalid stream cursor');
    }

    return runStream(run, after);
  }

  async stop(chatId: string, id: string, byRequest = false): Promise<void> {
    await this.admissions.get(chatId);
    if (byRequest) id = hash(`${chatId}:${id}`).slice(0, 32);

    const run = await this.find(chatId, id);
    if (!run) throw new RunError(404, 'search run not found');

    if (!run.settled) run.controller.abort('stop');
    await run.done;
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.admissions.values()]);
    const runs = [...this.active.values()];
    for (const run of runs) run.controller.abort('shutdown');

    await Promise.all(runs.map((run) => run.done));
    await closeBrowserSessions({ ownerRoot: this.sessions.dir });
  }

  private async start(input: RunInput): Promise<SearchRun> {
    if (this.closed) throw new RunError(503, 'search service is stopping');
    if (!isValidSessionId(input.chatId) || !isValidSessionId(input.requestId)) {
      throw new RunError(400, 'invalid chat or request id');
    }

    const id = hash(`${input.chatId}:${input.requestId}`).slice(0, 32);
    const fingerprint = hash(JSON.stringify([input.messages, input.trigger]));
    const existing = await this.find(input.chatId, id);
    if (existing) {
      if (existing.record.fingerprint !== fingerprint) throw new RunError(409, 'request id reused with different messages');

      return existing;
    }
    if (this.active.has(input.chatId)) throw new RunError(409, 'This chat has an active search. Reconnect or stop it first.');

    await validateHistory(this.sessions, input);
    const journal = new RunJournal(join(this.sessions.dir, '.runs', input.chatId, id));
    const run: SearchRun = { record: { ...input, id, fingerprint, status: 'running', createdAt: Date.now() },
      journal, events: [], tools: [], controller: new AbortController(), listeners: new Set(), done: Promise.resolve() };
    this.active.set(input.chatId, run);
    try {
      await journal.create(run.record);
      const prior = await this.sessions.load(input.chatId);
      await this.sessions.upsert({ id: input.chatId, title: prior?.title ?? 'New chat', messages: input.messages, serverRunId: id });
    } catch (error) {
      try {
        await journal.discard();
      } finally {
        this.active.delete(input.chatId);
      }
      throw error;
    }
    run.done = executeRun(run, this.generate, this.sessions, this.options.learning).catch((error) => {
      run.record.status = 'failed';
      run.record.error = String(error);
      console.error('search run persistence failed:', error);
    }).finally(() => {
      this.active.delete(input.chatId);
      run.settled = true;
      notify(run);
    });

    return run;
  }

  private load(directory: string): Promise<SearchRun | undefined> {
    const existing = this.loading.get(directory);
    if (existing) return existing;

    const pending = this.readRun(directory).finally(() => {
      this.loading.delete(directory);
    });
    this.loading.set(directory, pending);

    return pending;
  }

  private async readRun(directory: string): Promise<SearchRun | undefined> {
    const journal = new RunJournal(directory);
    const stored = await journal.read();
    if (!stored) return undefined;

    const run: SearchRun = { record: stored.record, journal,
      events: stored.entries.flatMap((entry) => entry.kind === 'chunk' ? [entry.chunk] : []),
      tools: stored.entries.flatMap((entry) => entry.kind === 'tool' ? [entry] : []),
      controller: new AbortController(), listeners: new Set(), done: Promise.resolve(), settled: true };
    await recoverInterruptedRun(run);

    return run;
  }

  private async recover(): Promise<void> {
    for (const summary of await this.sessions.list()) {
      const session = await this.sessions.load(summary.id);
      if (!session?.serverRunId) continue;

      const run = await this.load(join(this.sessions.dir, '.runs', session.id, session.serverRunId));
      if (!run) continue;

      await saveRunSession(this.sessions, run);
    }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
