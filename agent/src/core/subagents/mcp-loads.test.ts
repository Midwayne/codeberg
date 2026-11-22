import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonSchema, tool, type ToolExecutionOptions } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, it, vi } from 'vitest';

import { DEFAULT_PROFILE } from '../../providers/profiles.js';
import { ContextStore } from '../context/store.js';
import { selectActiveTools } from '../mcp/active.js';
import { SUBAGENT_TOOL } from './names.js';
import { subagentTools } from './tool.js';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

const options = { toolCallId: 'outer', messages: [] } as unknown as ToolExecutionOptions<unknown>;

it('loads MCP tools for one subagent only, without touching the activation the main agent and other chats share', async () => {
  const shared = vi.fn(async () => ({ loaded: ['mcp_grafana_query'] }));
  const schema = jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} });
  const tools = {
    grep: tool({ inputSchema: schema, execute: async () => 'ok' }),
    load_mcp_tools: tool({ inputSchema: jsonSchema<{ names: string[] }>({ type: 'object', properties: { names: { type: 'array' } } }), execute: shared }),
    mcp_grafana_query: tool({ inputSchema: schema, execute: async () => 'p99 120ms' }),
  };

  let step = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => {
    step++;
    if (step === 1) return { content: [{ type: 'tool-call' as const, toolCallId: 'load', toolName: 'load_mcp_tools',
      input: JSON.stringify({ names: ['mcp_grafana_query', 'mcp_missing_tool'] }) }], finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [] };

    return { content: [{ type: 'text' as const, text: 'done' }], finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] };
  } });

  // Like the main loop: deferred MCP tools stay hidden until something loads them.
  const worker = { model, profile: DEFAULT_PROFILE, activeTools: (all: readonly string[]) => selectActiveTools(all, []) };
  const set = subagentTools(worker, tools, ContextStore.open(mkdtempSync(join(tmpdir(), 'codeberg-mcp-loads-'))));

  const output = await set[SUBAGENT_TOOL]!.execute!({ tasks: [{ description: 'Check', prompt: 'Check latency' }] }, options);
  let last: any;
  for await (const item of output as AsyncIterable<unknown>) last = item;

  const offered = (call: number) => (model.doGenerateCalls[call]!.tools ?? []).map((entry) => entry.name);

  expect(shared).not.toHaveBeenCalled();
  expect(offered(0)).not.toContain('mcp_grafana_query');
  expect(offered(1)).toContain('mcp_grafana_query');
  expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('mcp_missing_tool');
  expect(last.results[0].status).toBe('completed');
});
