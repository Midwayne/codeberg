import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withProjectLog, writeLearningTrace, writeModuleLog } from './module-log.js';

describe('module logs', () => {
  it('appends scoped events across calls without mixing agent and learning events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeberg-logs-'));
    try {
      writeModuleLog('agent', 'turn_started', { id: 'one' }, dir);
      writeModuleLog('learning-agent', 'job_failed', { id: 'job-1' }, dir);
      writeModuleLog('agent', 'turn_completed', { id: 'one' }, dir);

      const agent = readFileSync(join(dir, 'agent.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      const learning = readFileSync(join(dir, 'learning-agent.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(agent.map((entry) => entry.event)).toEqual(['turn_started', 'turn_completed']);
      expect(learning.map((entry) => entry.event)).toEqual(['job_failed']);
      expect(agent[0].timestamp).toBeDefined();
      expect(statSync(join(dir, 'agent.log')).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a redacted and private knowledge trace separately from lifecycle logs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeberg-trace-'));
    try {
      writeLearningTrace(
        'model_response',
        { job_id: 'job-1', raw: 'Bearer abcde12345secret' },
        dir,
      );
      const trace = JSON.parse(readFileSync(join(dir, 'learning-agent-trace.log'), 'utf8'));
      expect(trace).toMatchObject({
        event: 'model_response',
        job_id: 'job-1',
        raw: 'Bearer [REDACTED]',
      });
      expect(statSync(join(dir, 'learning-agent-trace.log')).mode & 0o777).toBe(0o600);
      writeLearningTrace(
        'model_response',
        { raw: '{"action":"none","reason":"API_KEY=abcdefghi"}' },
        dir,
      );
      const second = readFileSync(join(dir, 'learning-agent-trace.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))[1];

      expect(JSON.parse(second.raw)).toEqual({ action: 'none', reason: 'API_KEY=[REDACTED]' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('keeps overlapping background work in its captured project log directory', async () => {
  const a = mkdtempSync(join(tmpdir(), 'project-log-a-'));
  const b = mkdtempSync(join(tmpdir(), 'project-log-b-'));
  try {
    const late = withProjectLog(a, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      writeLearningTrace('late', { project: 'a' });
    });

    withProjectLog(b, () => writeLearningTrace('current', { project: 'b' }));
    await late;
    expect(JSON.parse(readFileSync(join(a, 'learning-agent-trace.log'), 'utf8')).project).toBe('a');
    expect(JSON.parse(readFileSync(join(b, 'learning-agent-trace.log'), 'utf8')).project).toBe('b');
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});
