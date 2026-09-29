import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SessionActionsMenu, SessionSidebar } from './session-sidebar';
import type { SessionSummary } from '@/lib/sessions';

const sessions: SessionSummary[] = [
  { id: 'old', title: 'Archived conversation', updatedAt: 1, turns: 1, pinned: false, archived: true },
  { id: 'pin', title: 'Pinned conversation', updatedAt: 2, turns: 2, pinned: true, archived: false },
  { id: 'recent', title: 'Recent conversation', updatedAt: 3, turns: 1, pinned: false, archived: false },
];

function render(): string {
  return renderToStaticMarkup(<SessionSidebar
    sessions={sessions}
    currentId="pin" canBranch={false} onResume={() => undefined}
    onNew={() => undefined} onBranch={() => undefined}
    onDelete={() => undefined} onSetFlags={() => undefined}
  />);
}

describe('SessionSidebar', () => {
  it('separates pinned and recent chats while hiding archived chats in the active view', () => {
    const html = render();
    expect(html).toContain('Pinned conversation');
    expect(html).toContain('Recent conversation');
    expect(html).not.toContain('Archived conversation');
    expect(html).not.toContain('Search all chats');
    expect(html.indexOf('Pinned conversation')).toBeLessThan(html.indexOf('Recent conversation'));
    expect(html).toContain('aria-label="Actions for Pinned conversation"');
    expect(html).not.toContain('aria-label="Archive chat"');
  });

  it('shows reversible options and delete in the single actions menu', () => {
    const html = renderToStaticMarkup(<SessionActionsMenu session={sessions[0]} onAction={() => undefined} />);
    expect(html).toContain('Unarchive');
    expect(html).toContain('Pin');
    expect(html).toContain('Delete');
    expect(renderToStaticMarkup(<SessionActionsMenu session={sessions[1]} onAction={() => undefined} />)).toContain('Unpin');
  });
});
