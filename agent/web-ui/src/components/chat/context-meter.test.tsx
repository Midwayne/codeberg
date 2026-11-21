import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { formatTokens, percent, type ChatContextStats } from '../../lib/context-stats';
import { ContextPanel } from './context-panel';
import { ContextMeterView } from './context-meter';

const stats: ChatContextStats & { last: NonNullable<ChatContextStats['last']> } = {
  version: 1,
  requests: 14,
  compactions: 1,
  clearingPasses: 2,
  peak: 96_000,
  inputTokens: 400_000,
  cacheReadTokens: 300_000,
  recent: [],
  last: {
    at: 1,
    model: 'anthropic:claude-haiku-4-5',
    window: 200_000,
    ceiling: 160_000,
    clearAt: 80_000,
    estimated: 50_000,
    breakdown: { instructions: 2_500, context: 600, tools: 3_000, conversation: 20_000, toolResults: 18_000, cleared: 400, summary: 5_500, attachments: 0 },
    counts: { messages: 30, toolResults: 20, cleared: 8, spilled: 2 },
    summarized: true,
  },
};

describe('ContextMeterView', () => {
  it('shows the share of the working window on a closed control', () => {
    const html = renderToStaticMarkup(<ContextMeterView stats={stats} />);

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Context: 25% of the model');
    expect(html).not.toContain('role="dialog"');
  });
});

describe('ContextPanel', () => {
  it('lists each nonzero kind of content with tokens and share, and the chat counters', () => {
    const html = renderToStaticMarkup(<ContextPanel stats={stats} />);

    expect(html).toContain('50k of 200k tokens (25%)');
    expect(html).toContain('Tool results');
    expect(html).toContain('18k');
    expect(html).toContain('36%');
    expect(html).not.toContain('Attachments');
    expect(html).toContain('Summaries');
    expect(html).toContain('8 of 20');
    expect(html).toContain('Read from cache');
    expect(html).toContain('75%');
    expect(html).toContain('summarized at 160k');
  });
});

describe('formatting', () => {
  it('abbreviates token counts and never rounds a real share to zero', () => {
    expect([formatTokens(950), formatTokens(1_250), formatTokens(12_400), formatTokens(1_250_000)]).toEqual(['950', '1.3k', '12k', '1.25M']);
    expect([percent(1, 1_000), percent(0, 10), percent(5, 10)]).toEqual(['<1%', '0%', '50%']);
  });
});
