import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CleanupOptions, ResourceUsageView } from './settings';

describe('settings', () => {
  it('labels only Codeberg usage and history retention', () => {
    const html = renderToStaticMarkup(<ResourceUsageView usage={{ current: null, history: [], retentionMs: 3_600_000, sampleIntervalMs: 10_000 }} range={60} onRange={() => undefined} />);
    expect(html).toContain('Codeberg CPU');
    expect(html).toContain('Codeberg memory');
    expect(html).toContain('Codeberg disk');
    expect(html).not.toContain('Host memory');
    expect(html).toContain('one hour');
    expect(html).toContain('No samples yet');
  });

  it('offers independent categories, age filtering, and a disabled delete action until selection', () => {
    const html = renderToStaticMarkup(<CleanupOptions preview={{ categories: [
      { category: 'chats', count: 3, bytes: 1024 }, { category: 'training', count: 2, bytes: 2048 }, { category: 'knowledge', count: 1, bytes: 4096 },
    ] }} selected={[]} onSelect={() => undefined} days={30} onDays={() => undefined} busy={false} onDelete={() => undefined} />);
    expect(html).toContain('Saved chats');
    expect(html).toContain('Training data');
    expect(html).toContain('Knowledge documents');
    expect(html).toContain('Older than');
    expect(html).toContain('Pinned chats are kept');
    expect(html).toContain('disabled');
  });
});
