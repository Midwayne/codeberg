import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

import { Chat, type ChatProps } from './chat';
import { ProjectApiContext } from '../../lib/project-api';

vi.mock('../../canvas/use-settings', () => ({ useCanvasSettings: () => ({ enabled: true }) }));

it.each(['submitted', 'streaming'] as const)('shows %s activity in the conversation outside the composer', (status) => {
  const chat = {
    status,
    messages: [{ id: 'request', role: 'user', parts: [{ type: 'text', text: 'Current request' }] }],
  } as ChatProps['chat'];

  const html = renderToStaticMarkup(
    <ProjectApiContext.Provider value={{ project: { id: 'demo', name: 'Demo', roots: [] }, fetch, ready: true }}>
      <Chat chat={chat} sessionId="demo" learningEnabled={false} chatInputs={['text']} />
    </ProjectApiContext.Provider>,
  );
  const [conversation = '', composer = ''] = html.split('<section aria-label="Message composer"');
  const label = 'Thinking…';

  expect(conversation).toContain(label);
  expect(conversation.indexOf('Current request')).toBeLessThan(conversation.indexOf(label));
  expect(composer).toContain('aria-label="Message"');
  expect(composer).not.toContain(label);
});
