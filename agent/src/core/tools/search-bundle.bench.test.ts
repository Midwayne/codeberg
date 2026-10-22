import { writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { extractHybridHits } from '../evidence-extract.js';
import type { DaemonClient } from '../client.js';

const queries = ['api', 'worker', 'client'].map((repo) => ({ repo, query: 'authentication lifecycle' }));
const hit = (repo: string, id: number) => ({ repo, id, path: `${repo}/auth${id}.ts`, symbol: `authenticate${id}`,
  start_line: 1, end_line: 80, score: 1 / id, snippet: 'authentication '.repeat(30) });

function fixture() {
  let calls = 0;
  return { get calls() { return calls; }, callTool: async (name: string, args: any) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (name === 'hybrid_search') return Array.from({ length: 8 }, (_, index) => ({
      hit: hit(args.repo, index + 1), ...(index < 3 ? { context: 's'.repeat(index < 2 ? 2500 : 1000) } : {}), final_score: 1 / (index + 1),
    }));
    return { ...hit(args.repo, args.id), body: 'function authenticate() { /* checked evidence */ }\n'.repeat(60) };
  } };
}

it.skipIf(!process.env.CODEBERG_BUNDLE_BENCH_REPORT)('measures the fixed read-only pipeline against separate tool waves', async () => {
  const mode = process.env.CODEBERG_BUNDLE_BENCH_MODE ?? 'baseline';
  const modulePath = './search-bundle.js';
  const bundleModule = mode === 'bundle' ? await import(modulePath) : undefined;
  const samples = [];
  for (let trial = 0; trial < 5; trial++) {
    const daemon = fixture();
    const started = performance.now();
    let output: unknown;
    let evidence: any[];
    if (mode === 'baseline') {
      const searches = await Promise.all(queries.map((query) => daemon.callTool('hybrid_search', { ...query, k: 8 })));
      const groups = searches.map(extractHybridHits);
      const selected = Array.from({ length: 8 }, (_, rank) => groups.map((group) => group[rank])).flat().slice(0, 8);
      const bodies = await Promise.all(selected.map((row) => daemon.callTool('get_chunk', { repo: row.repo, id: row.id })));
      output = { searches, bodies };
      evidence = selected;
    } else {
      const { searchBundleSource } = bundleModule!;
      const tools = await searchBundleSource({ daemon: daemon as unknown as DaemonClient, onResults: () => {} }).tools();
      output = await (tools.search_bundle.execute as any)({ queries }, { toolCallId: 'bundle' });
      evidence = (output as any).evidence;
    }
    const required = queries.map(({ repo }) => `${repo}/auth1.ts`);
    const recall = required.filter((path) => evidence.some((row) => row.path === path)).length / required.length;
    expect(recall).toBe(1);
    samples.push({ trial, latencyMs: performance.now() - started, daemonCalls: daemon.calls,
      modelToolWaves: mode === 'baseline' ? 2 : 1, estimatedOutputTokens: Math.ceil(JSON.stringify(output).length / 4),
      requiredFileRecall: recall });
  }
  await writeFile(process.env.CODEBERG_BUNDLE_BENCH_REPORT!, JSON.stringify({ mode, samples }, null, 2));
});
