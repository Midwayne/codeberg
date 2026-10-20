import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { readSource } from '../src/core/learning/memory-source/reading.js';

const root = await mkdtemp(join(tmpdir(), 'source-bench-'));
await writeFile(join(root, 'source.ts'), 'export const value = 1;\n'.repeat(20000));
const repos = [{ path: root, commit: 'fixed' }];
const ref = { repo: root, path: 'source.ts' };
const start = performance.now();
const cpuStart = process.cpuUsage();
for (let i = 0; i < 200; i++) {
  const observation = await readSource(ref, repos);
  if (!observation.hash) throw new Error(observation.unavailable);
}
const cpu = process.cpuUsage(cpuStart);
console.log(JSON.stringify({ observations: 200, bytes: 460000, ms: performance.now() - start,
  cpuMs: (cpu.user + cpu.system) / 1000 }));
await rm(root, { recursive: true, force: true });
