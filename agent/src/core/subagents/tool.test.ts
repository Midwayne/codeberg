import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonSchema, tool, type ToolExecutionOptions } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { generateMock } from '../test-models.js';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PROFILE } from '../../providers/profiles.js';
import { backgroundContext, beginAgentStep, subagentsThisStep } from '../background/context.js';
import { chatScope } from '../chat-scope.js';
import { ContextStore } from '../context/store.js';
import { MESSAGE_TOOL, SUBAGENT_TOOL } from './names.js';
import type { SubagentReport } from './run.js';
import { subagentTools } from './tool.js';

type Generate = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>['doGenerate'];
type Brief = { description: string; prompt: string; agent_type?: 'explorer' | 'worker' };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

function answer(text: string) {
  return { content: [{ type: 'text' as const, text }], finishReason: { unified: 'stop' as const, raw: undefined },
    usage, warnings: [] };
}

function call(toolName: string, input: unknown, id = toolName) {
  return {
    content: [{ type: 'tool-call' as const, toolCallId: `c-${id}`, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
    usage,
    warnings: [],
  };
}

/** The delegated service, read from the subagent's prompt. */
function serviceOf(prompt: unknown): string {
  return JSON.stringify(prompt).includes('checkout') ? 'checkout' : 'billing';
}

const options = { toolCallId: 'outer', messages: [] } as unknown as ToolExecutionOptions<unknown>;

function setup(doGenerate: Generate, contextOf?: () => string, maxSteps?: number) {
  const status = vi.fn(async ({ service }: { service: string }) => `${service}: 3 errors in 5m`);
  const schema = jsonSchema<{ service: string }>({ type: 'object', properties: { service: { type: 'string' } } });
  const tools = {
    service_status: tool({ description: 'status', inputSchema: schema, execute: status }),
    run_script: tool({ description: 'script', inputSchema: schema, execute: async () => 'ran' }),
  };
  const model = generateMock(doGenerate);
  const store = ContextStore.open(mkdtempSync(join(tmpdir(), 'codeberg-subagent-tool-')));
  const set = subagentTools({ model, profile: DEFAULT_PROFILE, ...(contextOf ? { context: contextOf } : {}), ...(maxSteps ? { maxSteps } : {}) }, tools, store);

  const snapshots: SubagentReport[][] = [];
  const drain = async (output: unknown) => {
    let last: { results: SubagentReport[] } | undefined;
    for await (const item of output as AsyncIterable<{ results: SubagentReport[] }>) {
      snapshots.push(item.results);
      last = item;
    }

    return last!.results;
  };
  const run = async (tasks: Brief[]) => drain(await set[SUBAGENT_TOOL]!.execute!({ tasks }, options));
  const message = async (agent_id: string, text: string) =>
    (await drain(await set[MESSAGE_TOOL]!.execute!({ agent_id, message: text }, options)))[0]!;

  return { run, message, status, model, snapshots, context: store, set, drain };
}

describe('run_subagents', () => {
  it('runs every brief and returns one report per task with id, usage, and transcript', async () => {
    const seen = new Map<string, number>();
    const { run, status } = setup(async ({ prompt }) => {
      const service = serviceOf(prompt);
      const step = (seen.get(service) ?? 0) + 1;
      seen.set(service, step);

      return step === 1 ? call('service_status', { service }) : answer(`${service} is degraded`);
    });

    const results = await run([
      { description: 'Check checkout', prompt: 'Check checkout health' },
      { description: 'Check billing', prompt: 'Check billing health', agent_type: 'worker' },
    ]);

    expect(status).toHaveBeenCalledTimes(2);
    expect(results.map(({ description, agent_type, status: state, report, tool_calls }) =>
      ({ description, agent_type, state, report, tool_calls }))).toEqual([
      { description: 'Check checkout', agent_type: 'explorer', state: 'completed', report: 'checkout is degraded', tool_calls: 1 },
      { description: 'Check billing', agent_type: 'worker', state: 'completed', report: 'billing is degraded', tool_calls: 1 },
    ]);
    expect(results[0]!.agent_id).not.toBe(results[1]!.agent_id);
    expect(results[0]!.usage).toEqual({ input_tokens: 20, output_tokens: 4 });
    expect(readFileSync(results[0]!.transcript!, 'utf8')).toContain('checkout: 3 errors in 5m');
  });

  it('reports a failed subagent without failing the others', async () => {
    const { run } = setup(async ({ prompt }) => {
      if (serviceOf(prompt) === 'billing') throw new Error('rate limited');

      return answer('checkout is fine');
    });

    const results = await run([
      { description: 'Check checkout', prompt: 'Check checkout health' },
      { description: 'Check billing', prompt: 'Check billing health' },
    ]);

    expect(results[0]).toMatchObject({ status: 'completed', report: 'checkout is fine' });
    expect(results[1]).toMatchObject({ status: 'failed' });
    expect(results[1]!.error).toContain('rate limited');
  });

  it('sends a role system prompt and only the brief, and keeps scripts from explorers', async () => {
    const { run, model } = setup(async () => answer('done'));

    await run([{ description: 'Check checkout', prompt: 'Check checkout health' }]);
    const { prompt, tools } = model.doGenerateCalls[0]!;

    expect(JSON.stringify(prompt[0])).toContain('explorer');
    expect(JSON.stringify(prompt[0])).not.toContain('load_mcp_tools');
    expect(prompt.filter((entry) => entry.role === 'user')).toHaveLength(1);
    expect(JSON.stringify(prompt.at(-1))).toContain('Check checkout health');
    expect((tools ?? []).map((entry) => entry.name)).toEqual(['service_status']);
  });

  it('forces a final report without tools when a configured step budget runs out', async () => {
    const { run, model } = setup(async ({ toolChoice }) =>
      toolChoice?.type === 'none' ? answer('partial: checkout errors rising') : call('service_status', { service: 'checkout' }), undefined, 4);

    const [result] = await run([{ description: 'Check checkout', prompt: 'Check checkout health' }]);

    expect(model.doGenerateCalls).toHaveLength(4);
    expect(result).toMatchObject({ status: 'incomplete', report: 'partial: checkout errors rising' });
  });

  it('keeps working until it answers when no step budget is set', async () => {
    let step = 0;
    const { run, model } = setup(async () =>
      ++step <= 30 ? call('service_status', { service: 'checkout' }, `s${step}`) : answer('checkout: 30 checks clean'));

    const [result] = await run([{ description: 'Check checkout', prompt: 'Check checkout health' }]);

    expect(model.doGenerateCalls).toHaveLength(31);
    expect(result).toMatchObject({ status: 'completed', report: 'checkout: 30 checks clean', steps: 31 });
  });
});

describe('live progress', () => {
  it('streams queued, running, and tool activity before the final reports', async () => {
    let step = 0;
    const { run, snapshots } = setup(async () => {
      await new Promise((resolve) => setTimeout(resolve, step === 0 ? 5 : 400));

      return ++step === 1 ? call('service_status', { service: 'checkout' }) : answer('checkout is degraded');
    });

    const [final] = await run([{ description: 'Check checkout', prompt: 'Check checkout health' }]);
    const states = snapshots.map((items) => items[0]!.status);

    expect(states[0]).toBe('queued');
    expect(states).toContain('running');
    expect(snapshots.some((items) => items[0]!.activity === 'service_status')).toBe(true);
    expect(final).toMatchObject({ status: 'completed', steps: 2 });
    expect(final!.activity).toBeUndefined();
  });
});

describe('message_subagent', () => {
  it('continues a finished subagent with its own history', async () => {
    let step = 0;
    const { run, message, model } = setup(async () => answer(++step === 1 ? 'checkout p99 is 900ms' : 'p50 is 120ms'));

    const [first] = await run([{ description: 'Check checkout', prompt: 'Check checkout latency' }]);
    const followUp = await message(first!.agent_id, 'What is p50?');
    const prompt = JSON.stringify(model.doGenerateCalls[1]!.prompt);

    expect(followUp).toMatchObject({ agent_id: first!.agent_id, status: 'completed', report: 'p50 is 120ms' });
    expect(prompt).toContain('Check checkout latency');
    expect(prompt).toContain('checkout p99 is 900ms');
    expect(prompt).toContain('What is p50?');
  });

  it('rejects an unknown agent id', async () => {
    const { message } = setup(async () => answer('unused'));

    await expect(message('sa_missing', 'hi')).rejects.toThrow(/unknown subagent/i);
  });
});

describe('transcript failures', () => {
  it('keeps a finished report when the transcript cannot be written', async () => {
    const { run, context } = setup(async () => answer('checkout is fine'));
    vi.spyOn(context, 'writeRel').mockRejectedValue(new Error('disk full'));

    const [result] = await run([{ description: 'Check checkout', prompt: 'Check checkout health' }]);

    expect(result).toMatchObject({ status: 'completed', report: 'checkout is fine' });
    expect(result!.transcript).toBeUndefined();
  });
});

describe('chat scope', () => {
  it('keeps one chat\'s subagents out of reach of another chat', async () => {
    const { run, message } = setup(async () => answer('checkout is fine'));

    const [first] = await chatScope.run('chat-a', () => run([{ description: 'Check checkout', prompt: 'Check checkout' }]));

    await expect(chatScope.run('chat-b', () => message(first!.agent_id, 'More?'))).rejects.toThrow(/unknown subagent/i);
    await expect(chatScope.run('chat-a', () => message(first!.agent_id, 'More?'))).resolves.toMatchObject({ status: 'completed' });
  });
});

describe('report previews', () => {
  it('streams a long finished report in full once, then as a marked preview', async () => {
    const long = 'r'.repeat(600);
    let calls = 0;
    const { run, snapshots } = setup(async ({ prompt }) => {
      calls++;
      if (serviceOf(prompt) === 'checkout') return answer(long);

      await new Promise((resolve) => setTimeout(resolve, 700));

      return answer('billing is fine');
    });

    const results = await run([
      { description: 'Check checkout', prompt: 'Check checkout health' },
      { description: 'Check billing', prompt: 'Check billing health' },
    ]);
    const live = snapshots.slice(0, -1).map((items) => items[0]!).filter((row) => row.report);

    expect(calls).toBe(2);
    expect(live[0]).toMatchObject({ report: long });
    expect(live[0]!.report_truncated).toBeUndefined();
    expect(live.at(-1)).toMatchObject({ report_truncated: true });
    expect(results[0]!.report).toBe(long);
  });
});

describe('foreground subagents', () => {
  it('count for the whole step that called them, even after they finish, until the next step', async () => {
    const { run } = setup(async () => answer('done'));
    const scope = { chatId: 'chat', sourceRunId: 'turn', jobs: {} as never, sleeping: false };

    await backgroundContext.run(scope, async () => {
      await run([{ description: 'Check', prompt: 'Check checkout' }]);

      expect(subagentsThisStep()).toBe(true);

      beginAgentStep();

      expect(subagentsThisStep()).toBe(false);
    });
  });
});

describe('subagent context', () => {
  it('tells subagents which repositories and MCP servers exist so they can load MCP tools themselves', async () => {
    const listing = 'MCP tools:\n- grafana: mcp_grafana_query';
    const { run, model } = setup(async () => answer('done'), () => listing);

    await run([{ description: 'Check', prompt: 'Check checkout' }]);

    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain('mcp_grafana_query');
  });
});

describe('stopping subagents', () => {
  it('yields every finished report in full before the stop error, so a background job keeps them', async () => {
    const long = `checkout is fine. ${'detail '.repeat(80)}`;
    const { set, snapshots } = setup(async ({ prompt, abortSignal }) => {
      if (serviceOf(prompt) === 'checkout') return answer(long);

      return new Promise((_resolve, reject) => abortSignal!.addEventListener('abort', () => reject(new Error('stopped'))));
    });
    const controller = new AbortController();
    const output = await set[SUBAGENT_TOOL]!.execute!({ tasks: [
      { description: 'Check checkout', prompt: 'Check checkout' },
      { description: 'Check billing', prompt: 'Check billing' },
    ] }, { ...options, abortSignal: controller.signal });

    const seen: SubagentReport[][] = [];
    const drained = (async () => {
      for await (const item of output as AsyncIterable<{ results: SubagentReport[] }>) seen.push(item.results);
    })();

    await vi.waitFor(() => expect(seen.at(-1)?.[0]?.status).toBe('completed'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    controller.abort();

    await expect(drained).rejects.toThrow();
    expect(seen.at(-1)?.[0]).toMatchObject({ status: 'completed', report: long.trim() });
    expect(seen.at(-1)?.[0]?.report_truncated).toBeUndefined();
    expect(snapshots).toEqual([]);
  });
});

describe('stopping a subagent mid-run', () => {
  it('settles when the user stops it during a later step instead of hanging', async () => {
    let calls = 0;
    const { set } = setup(async ({ abortSignal }) => {
      if (++calls === 1) return call('service_status', { service: 'checkout' });

      return new Promise((_resolve, reject) => abortSignal!.addEventListener('abort', () => reject(abortSignal!.reason)));
    });
    const controller = new AbortController();
    const output = await set[SUBAGENT_TOOL]!.execute!({ tasks: [{ description: 'Check checkout', prompt: 'Check checkout' }] },
      { ...options, abortSignal: controller.signal });

    const drained = (async () => {
      for await (const _item of output as AsyncIterable<unknown>) { /* drain */ }
    })();

    await vi.waitFor(() => expect(calls).toBe(2));
    controller.abort(new Error('User stopped'));

    await expect(Promise.race([drained, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('hung')), 2_000))]))
      .rejects.toThrow('User stopped');
  });
});
