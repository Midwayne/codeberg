import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { ChatSaveState } from '../../sessions/chat-save-state';
import { ChatSaveNotice } from './chat-save-notice';

it('only shows a storage warning after an actual failure, with an accessible retry action', () => {
  const state = new ChatSaveState(async () => {});
  expect(renderToStaticMarkup(<ChatSaveNotice state={state} />)).toBe('');

  state.failed(new Error('Could not save chat (500)'));
  const html = renderToStaticMarkup(<ChatSaveNotice state={state} />);

  expect(html).toContain('role="alert"');
  expect(html).toContain('Chat changes aren’t saved yet. Keep this tab open.');
  expect(html).toContain('Could not save chat (500)');
  expect(html).toContain('Retry save');
});

it('disables save retries while one is in flight', async () => {
  let resolve!: () => void;
  const state = new ChatSaveState(() => new Promise((done) => { resolve = done; }));
  state.failed(new Error('Network unavailable'));
  const retrying = state.retry();

  const html = renderToStaticMarkup(<ChatSaveNotice state={state} />);
  expect(html).toContain('disabled=""');
  expect(html).toContain('Saving…');

  resolve();
  await retrying;
});
