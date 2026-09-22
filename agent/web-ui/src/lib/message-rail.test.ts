import { describe, expect, it } from 'vitest';

import {
  activeMarkerId,
  clampTooltipTop,
  collectUserMarkers,
  layoutMarkers,
  markerId,
  nearestMarkerId,
  promptPreview,
  userPromptText,
} from './message-rail';

describe('userPromptText', () => {
  it('joins text parts and ignores non-text', () => {
    expect(
      userPromptText({
        parts: [
          { type: 'text', text: 'Hello ' },
          { type: 'reasoning', text: 'secret' },
          { type: 'text', text: 'world' },
        ],
      }),
    ).toBe('Hello world');
  });

  it('returns empty string when there is no text', () => {
    expect(userPromptText({ parts: [] })).toBe('');
    expect(userPromptText({})).toBe('');
  });
});

describe('promptPreview', () => {
  it('collapses whitespace and trims', () => {
    expect(promptPreview('  where is\n  chunking  ')).toBe('where is chunking');
  });

  it('uses a placeholder for blank prompts', () => {
    expect(promptPreview('')).toBe('Empty message');
    expect(promptPreview(' \n\t ')).toBe('Empty message');
  });

  it('truncates long prompts with an ellipsis', () => {
    const long = 'word '.repeat(80).trim();
    const preview = promptPreview(long, 40);
    expect(preview.length).toBe(40);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.slice(0, 39)).toBe(long.slice(0, 39));
  });

  it('leaves short prompts intact', () => {
    expect(promptPreview('Find the indexer', 40)).toBe('Find the indexer');
  });
});

describe('markerId', () => {
  it('prefers a non-empty id and falls back to role-index', () => {
    expect(markerId({ id: 'abc', role: 'user' }, 3)).toBe('abc');
    expect(markerId({ id: '', role: 'user' }, 3)).toBe('user-3');
    expect(markerId({ role: 'assistant' }, 1)).toBe('assistant-1');
  });
});

describe('collectUserMarkers', () => {
  it('keeps only user turns, in order, with fallback ids', () => {
    const markers = collectUserMarkers([
      { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'one' }] },
      { id: '', role: 'user', parts: [{ type: 'text', text: 'two' }] },
      { id: 's', role: 'system', parts: [{ type: 'text', text: 'sys' }] },
      { role: 'user', parts: [{ type: 'text', text: 'three' }] },
    ]);
    expect(markers).toEqual([
      { id: 'u1', prompt: 'one' },
      { id: 'user-2', prompt: 'two' },
      { id: 'user-4', prompt: 'three' },
    ]);
  });

  it('returns empty when the chat has no user turns', () => {
    expect(collectUserMarkers([{ id: 'a', role: 'assistant', parts: [] }])).toEqual([]);
  });
});

describe('layoutMarkers', () => {
  it('returns empty for no markers or a degenerate track', () => {
    expect(layoutMarkers([{ id: 'a', fraction: 0.2 }], 0)).toEqual([]);
    expect(layoutMarkers([], 200)).toEqual([]);
    expect(layoutMarkers([{ id: 'a', fraction: 0.2 }], -10)).toEqual([]);
  });

  it('places a single marker at its clamped fraction', () => {
    const [one] = layoutMarkers([{ id: 'a', fraction: 0.5 }], 100, {
      pad: 10,
      markerSize: 0,
      minGap: 8,
    });
    expect(one.id).toBe('a');
    expect(one.top).toBe(50);

    const [high] = layoutMarkers([{ id: 'a', fraction: 2 }], 100, {
      pad: 10,
      markerSize: 0,
    });
    expect(high.top).toBe(90);

    const [nan] = layoutMarkers([{ id: 'a', fraction: Number.NaN }], 100, {
      pad: 10,
      markerSize: 0,
    });
    expect(nan.top).toBe(10);
  });

  it('spreads overlapping fractions so ticks stay ordered and at least minGap apart', () => {
    const laid = layoutMarkers(
      [
        { id: 'a', fraction: 0.5 },
        { id: 'b', fraction: 0.5 },
        { id: 'c', fraction: 0.5 },
      ],
      200,
      { pad: 10, markerSize: 0, minGap: 12 },
    );
    expect(laid.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(laid[1].top - laid[0].top).toBeGreaterThanOrEqual(12);
    expect(laid[2].top - laid[1].top).toBeGreaterThanOrEqual(12);
    expect(laid[0].top).toBeGreaterThanOrEqual(10);
    expect(laid[2].top).toBeLessThanOrEqual(190);
  });

  it('evenly distributes when there are more ticks than the track can space', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      fraction: 0.1,
    }));
    const laid = layoutMarkers(items, 50, { pad: 5, markerSize: 0, minGap: 12 });
    expect(laid).toHaveLength(10);
    expect(laid[0].top).toBe(5);
    expect(laid[9].top).toBe(45);
    for (let i = 1; i < laid.length; i++) {
      expect(laid[i].top).toBeGreaterThan(laid[i - 1].top);
    }
  });

  it('preserves conversation order even when fractions are inverted', () => {
    const laid = layoutMarkers(
      [
        { id: 'first', fraction: 0.9 },
        { id: 'second', fraction: 0.1 },
      ],
      100,
      { pad: 0, markerSize: 0, minGap: 8 },
    );
    expect(laid[0].id).toBe('first');
    expect(laid[1].id).toBe('second');
    expect(laid[1].top).toBeGreaterThan(laid[0].top);
  });
});

describe('activeMarkerId', () => {
  const markers = [
    { id: 'a', topInContent: 0 },
    { id: 'b', topInContent: 400 },
    { id: 'c', topInContent: 900 },
  ];

  it('returns null when there are no markers', () => {
    expect(activeMarkerId([], 0, 100, 1000)).toBeNull();
  });

  it('selects the last user prompt whose top has scrolled past the probe', () => {
    expect(activeMarkerId(markers, 0, 300, 1200)).toBe('a');
    expect(activeMarkerId(markers, 350, 300, 1200)).toBe('b');
    expect(activeMarkerId(markers, 850, 300, 1200)).toBe('c');
  });

  it('pins to the last marker when the user is at the bottom', () => {
    expect(activeMarkerId(markers, 890, 300, 1200)).toBe('c');
  });
});

describe('nearestMarkerId', () => {
  const laid = [
    { id: 'a', top: 10 },
    { id: 'b', top: 50 },
    { id: 'c', top: 90 },
  ];

  it('returns null for an empty rail or non-finite y', () => {
    expect(nearestMarkerId([], 10)).toBeNull();
    expect(nearestMarkerId(laid, Number.NaN)).toBeNull();
  });

  it('picks the closest tick, including when the pointer is between ticks', () => {
    expect(nearestMarkerId(laid, 10)).toBe('a');
    expect(nearestMarkerId(laid, 28)).toBe('a');
    expect(nearestMarkerId(laid, 32)).toBe('b');
    expect(nearestMarkerId(laid, 200)).toBe('c');
  });
});

describe('clampTooltipTop', () => {
  it('centers on the tick then clamps to the track', () => {
    expect(clampTooltipTop(50, 20, 200)).toBe(40);
    expect(clampTooltipTop(2, 20, 200, 4)).toBe(4);
    expect(clampTooltipTop(195, 20, 200, 4)).toBe(176);
  });

  it('pins to pad when the tooltip is taller than the track', () => {
    expect(clampTooltipTop(50, 400, 100, 4)).toBe(4);
  });
});
