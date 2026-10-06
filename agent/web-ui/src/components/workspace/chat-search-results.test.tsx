import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { ChatSearchResults, type ChatSearchResultsProps } from './chat-search-results';
import type { ChatSearchResult } from '@/lib/chat-search';

it('keeps result indexes stable across repeated renders without mutating shared state', () => {
  const hit: ChatSearchResult = {
    id: 'current',
    title: 'Current chat',
    messageId: 'answer',
    role: 'assistant',
    snippet: 'Cache refresh',
    pinned: false,
    archived: false,
    updatedAt: 1,
  };
  const other = { ...hit, id: 'other', title: 'Other chat' };
  const state: ChatSearchResultsProps['state'] = {
    current: [hit],
    others: [other],
    all: [hit, other],
    query: 'cache',
    active: 0,
    loading: false,
    error: '',
    dialogRef: createRef<HTMLElement>(),
    inputRef: createRef<HTMLInputElement>(),
    resultsRef: createRef<HTMLDivElement>(),
    onClose: () => {},
    choose: () => {},
    setActive: () => {},
    setQuery: () => {},
  };

  const first = renderToStaticMarkup(<ChatSearchResults state={state} />);
  const second = renderToStaticMarkup(<ChatSearchResults state={state} />);

  expect(second).toBe(first);
  expect(first).toContain('data-search-index="0"');
  expect(first).toContain('data-search-index="1"');
  expect(state).not.toHaveProperty('index');
});
