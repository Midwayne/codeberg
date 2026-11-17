import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { formatElapsed, toolLabel, waitingLabel, waitingLabels, workingPhase } from './working-phase';

describe('working phase', () => {
  it('rotates waiting labels and wraps around the pool', () => {
    expect(waitingLabel(0, 0)).toBe('Thinking');
    expect(waitingLabel(0, 1)).toBe(waitingLabels[1]);
    expect(waitingLabel(0, waitingLabels.length)).toBe('Thinking');
  });

  it('falls back to a generic label for unknown tools', () => {
    expect(toolLabel('find_symbol')).toBe('Locating a symbol');
    expect(toolLabel('custom_mcp_tool')).toBe('Using a tool');
  });

  it('returns to waiting once a tool has finished', () => {
    const messages: UIMessage[] = [{ id: 'answer', role: 'assistant', parts: [
      { type: 'dynamic-tool', toolName: 'grep', toolCallId: 'search', state: 'output-available', input: {}, output: '' },
    ] }];

    expect(workingPhase(messages, 0).kind).toBe('waiting');
  });

  it('reads static tool part names', () => {
    const messages = [{ id: 'answer', role: 'assistant', parts: [
      { type: 'tool-git_log', toolCallId: 'log', state: 'input-streaming', input: {} },
    ] }] as UIMessage[];

    expect(workingPhase(messages, 0)).toEqual({ kind: 'tool', label: 'Reading history' });
  });
});

describe('elapsed time', () => {
  it('stays hidden for quick turns and then shows seconds and minutes', () => {
    expect(formatElapsed(2)).toBe('');
    expect(formatElapsed(12)).toBe('12s');
    expect(formatElapsed(65)).toBe('1m 05s');
  });
});
