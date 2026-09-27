import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { writeModuleLog } from './module-log.js';

describe('module logs', () => {
  it('appends scoped events across calls without mixing agent and learning events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeberg-logs-'));
    try {
      writeModuleLog('agent', 'turn_started', { id: 'one' }, dir);
      writeModuleLog('learning-agent', 'job_failed', { id: 'job-1' }, dir);
      writeModuleLog('agent', 'turn_completed', { id: 'one' }, dir);

      const agent = readFileSync(join(dir, 'agent.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      const learning = readFileSync(join(dir, 'learning-agent.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(agent.map((entry) => entry.event)).toEqual(['turn_started', 'turn_completed']);
      expect(learning.map((entry) => entry.event)).toEqual(['job_failed']);
      expect(agent[0].timestamp).toBeDefined();
      expect(statSync(join(dir, 'agent.log')).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
