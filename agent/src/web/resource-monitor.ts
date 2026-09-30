import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

import { writeModuleLog } from '../core/module-log.js';
import type { ResourceSample } from './resources.js';

export const SAMPLE_MS = 10_000;
export const DISK_MS = 5 * 60_000;
export const RETENTION_MS = 60 * 60_000;

export interface ResourceReader {
  start(): void;
  stop(): void;
  read(after?: number): Promise<string> | string;
  invalidateDisk(): void;
}

export interface ResourceWorkerData {
  home: string;
  sessionsDir: string;
  learningRoot: string;
  daemonUrl?: string;
  env?: NodeJS.ProcessEnv;
}

/** The chat process transports cached metrics; it never collects them itself. */
export class ResourceMonitorClient implements ResourceReader {
  private started = false;
  private daemonReady = false;
  private peerPid?: string;
  private probing?: Promise<void>;
  private retry?: NodeJS.Timeout;
  private worker?: Worker;
  private workerId = '';
  private history: ResourceSample[] = [];
  private readonly endpoint?: URL;
  private readonly controller = new AbortController();

  constructor(private readonly options: ResourceWorkerData & {
    fetch?: typeof globalThis.fetch;
    createWorker?: (data: ResourceWorkerData) => Worker;
  }) {
    if (options.daemonUrl) {
      try {
        const url = new URL(options.daemonUrl);
        if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) this.endpoint = url;
      } catch { /* Ancillary monitoring must not break the chat server. */ }
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.endpoint) void this.probe();
    else this.startWorker();
  }

  stop(): void {
    this.started = false;
    this.controller.abort();
    if (this.retry) clearTimeout(this.retry);
    void this.worker?.terminate();
    this.worker = undefined;
  }

  async read(after = 0): Promise<string> {
    if (!this.started) this.start();
    if (this.daemonReady) {
      try {
        const url = new URL('/resources', this.endpoint);
        if (after) url.searchParams.set('after', String(after));
        const response = await this.request(url);
        if (!response.ok) throw new Error(`resource daemon returned ${response.status}`);
        if (response.headers.get('X-Codeberg-Pid') !== this.peerPid) void this.probe();
        return await response.text(); // Relay bytes without parsing/re-encoding history.
      } catch {
        this.daemonReady = false;
        if (this.started) { this.startWorker(); this.scheduleProbe(); }
      }
    }
    const current = this.history.at(-1) ?? null;
    if (current && after > current.timestamp) after = 0;
    return JSON.stringify({ current, history: this.history.filter((row) => row.timestamp > after).map((row) => ({ ...row, processes: [] })),
      retentionMs: RETENTION_MS, sampleIntervalMs: SAMPLE_MS, diskIntervalMs: DISK_MS, collector: 'worker', collectorId: this.workerId });
  }

  invalidateDisk(): void {
    if (this.daemonReady) {
      void this.request(new URL('/resources/refresh', this.endpoint), { method: 'POST' }).catch(() => undefined);
    } else this.worker?.postMessage({ kind: 'refreshDisk' });
  }

  private request(url: URL, init: RequestInit = {}): Promise<Response> {
    return (this.options.fetch ?? globalThis.fetch)(url, { ...init,
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(1000)]) });
  }

  private probe(): Promise<void> {
    if (!this.endpoint || !this.started) return Promise.resolve();
    this.probing ??= (async () => {
      try {
        const response = await this.request(new URL('/resources/clients', this.endpoint), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: process.pid }),
        });
        if (!response.ok) throw new Error('daemon collector unavailable');
        await response.arrayBuffer();
        if (!this.started) return;
        this.peerPid = response.headers.get('X-Codeberg-Pid') ?? undefined;
        this.daemonReady = true;
        if (this.retry) clearTimeout(this.retry);
        this.retry = undefined;
        void this.worker?.terminate();
        this.worker = undefined;
        this.history = [];
      } catch {
        if (this.started) { this.startWorker(); this.scheduleProbe(); }
      }
    })().finally(() => { this.probing = undefined; });
    return this.probing;
  }

  private scheduleProbe(): void {
    if (this.retry || !this.endpoint || !this.started) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.probe(); }, 30_000);
    this.retry.unref();
  }

  private startWorker(): void {
    if (this.worker || !this.started) return;
    this.workerId = randomUUID();
    this.history = [];
    const data: ResourceWorkerData = { home: this.options.home, sessionsDir: this.options.sessionsDir,
      learningRoot: this.options.learningRoot, env: this.options.env, daemonUrl: this.options.daemonUrl };
    this.worker = this.options.createWorker?.(data) ?? new Worker(new URL('./resource-worker.js', import.meta.url), { workerData: data });
    this.worker.unref();
    this.worker.on('message', (message: { kind: string; sample?: ResourceSample }) => {
      if (!this.started || !message.sample || message.kind !== 'sample') return;
      const sample = message.sample;
      const previous = this.history.at(-1);
      if (previous && previous.timestamp !== sample.timestamp) this.history[this.history.length - 1] = { ...previous, processes: [] };
      this.history = [...this.history.filter((row) => row.timestamp > sample.timestamp - RETENTION_MS && row.timestamp !== sample.timestamp), sample].slice(-360);
    });
    this.worker.on('error', (error) => { writeModuleLog('agent', 'resource_monitor_failed', { error: String(error) }); });
    const worker = this.worker;
    worker.on('exit', () => {
      if (!this.started || this.worker !== worker) return;
      this.worker = undefined;
      if (this.endpoint) this.scheduleProbe();
      else if (!this.retry) {
        this.retry = setTimeout(() => { this.retry = undefined; this.startWorker(); }, 30_000);
        this.retry.unref();
      }
    });
  }
}
