import { createAnthropic } from '@ai-sdk/anthropic';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { profileFor } from '../../providers/profiles.js';
import { Agent } from '../agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';

interface AnthropicBlock {
  type: string;
  cache_control?: { type: string };
}

interface AnthropicRequest {
  system?: AnthropicBlock[];
  messages: { role: string; content: AnthropicBlock[] }[];
}

function anthropicReply(content: unknown[], stopReason: string): Response {
  const body = {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-8',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function scriptedAnthropic(requests: AnthropicRequest[]) {
  const replies = [
    anthropicReply(
      [{ type: 'tool_use', id: 'toolu_1', name: 'grep', input: { pattern: 'chunk' } }],
      'tool_use',
    ),
    anthropicReply(
      [{ type: 'tool_use', id: 'toolu_2', name: 'grep', input: { pattern: 'embed' } }],
      'tool_use',
    ),
    anthropicReply([{ type: 'text', text: 'Chunking lives in core/src/chunk.c.' }], 'end_turn'),
  ];

  const fetch = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    requests.push(JSON.parse(String(init?.body)) as AnthropicRequest);

    return replies.shift()!;
  });

  return createAnthropic({ apiKey: 'test', fetch: fetch as unknown as typeof globalThis.fetch });
}

function mockDaemon(): DaemonClient {
  const daemon = new DaemonClient(DEFAULT_DAEMON_URL);

  vi.spyOn(daemon, 'waitReady').mockResolvedValue({
    ready: true,
    chunks: 0,
    version: 'test',
    vectors_enabled: false,
  });

  vi.spyOn(daemon, 'listTools').mockResolvedValue([
    {
      name: 'grep',
      description: 'Search source files',
      schema: { type: 'object', properties: { pattern: { type: 'string' } } },
    },
  ]);

  vi.spyOn(daemon, 'callTool').mockResolvedValue([{ path: 'core/src/chunk.c', line: 12 }]);

  return daemon;
}

function cachedBlocks(request: AnthropicRequest): string[] {
  return request.messages.flatMap((message) =>
    message.content
      .filter((block) => block.cache_control?.type === 'ephemeral')
      .map((block) => `${message.role}:${block.type}`),
  );
}

describe('Anthropic conversation caching', () => {
  it('marks the transcript tail cacheable on every tool step', async () => {
    const requests: AnthropicRequest[] = [];
    const provider = scriptedAnthropic(requests);

    const agent = new Agent({
      model: provider('claude-opus-4-8'),
      daemon: mockDaemon(),
      learning: false,
      profile: profileFor('anthropic:claude-opus-4-8', {}),
      promptHooks: [],
      web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
      mcp: { enabled: false, servers: [], files: [], warnings: [] },
      context: ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-anthropic-cache-'))),
    });

    const result = await agent.ask('where is chunking implemented?');

    expect(result.answer).toContain('core/src/chunk.c');
    expect(requests).toHaveLength(3);

    expect(requests[0]!.system?.at(-1)?.cache_control?.type).toBe('ephemeral');
    expect(cachedBlocks(requests[0]!)).toEqual(['user:text']);

    // Step 2 reads the question prefix step 1 wrote and writes through the first result.
    expect(cachedBlocks(requests[1]!)).toEqual(['user:text', 'user:tool_result']);

    // Step 3 reads through the first result and writes through the second.
    expect(cachedBlocks(requests[2]!)).toEqual(['user:tool_result', 'user:tool_result']);

    await agent.close();
  });
});
