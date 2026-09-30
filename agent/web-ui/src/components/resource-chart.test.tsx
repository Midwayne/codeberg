import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResourceChart, sampleAtPosition } from './resource-chart';
import type { ResourceSample } from '@/lib/resources';

const rows = [0, 15_000, 60_000].map((timestamp) => ({ timestamp, memory: { usedBytes: 100 + timestamp } }) as ResourceSample);

describe('resource history chart', () => {
  it('shows the nearest real sample for a pointer position on the time axis, including irregular intervals', () => {
    expect(sampleAtPosition(rows, 0, 60_000, 0.3)?.timestamp).toBe(15_000);
    expect(sampleAtPosition(rows, 0, 60_000, -1)?.timestamp).toBe(0);
    expect(sampleAtPosition(rows, 0, 60_000, 2)?.timestamp).toBe(60_000);
    expect(sampleAtPosition([], 0, 60_000, 0.5)).toBeUndefined();
  });

  it('includes exact formatted values and timestamps for each point, with keyboard-accessible navigation', () => {
    const html = renderToStaticMarkup(<ResourceChart title="Memory history" rows={rows} value={(row) => row.memory.usedBytes} format={(value) => `${value} B`} range={5} end={60_000} />);
    expect(html).toContain('60100 B');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('ArrowLeft ArrowRight Home End');
    expect(html).toContain('Memory history');
  });
});
