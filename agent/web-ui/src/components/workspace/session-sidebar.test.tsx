import type { SessionSummary } from '@agent/core/api/sessions.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DeleteChatDialog, SessionActionsMenu } from './sidebar-actions';
import { SessionSidebar } from './session-sidebar';

const sessions: SessionSummary[] = [
  { id: 'old', title: 'Archived conversation', updatedAt: 1, turns: 1, pinned: false, archived: true },
  { id: 'pin', title: 'Pinned conversation', updatedAt: 2, turns: 2, pinned: true, archived: false },
  { id: 'recent', title: 'Recent conversation', updatedAt: 3, turns: 1, pinned: false, archived: false },
];

function render(scheduledChatIds?: ReadonlySet<string>): string {
  return renderToStaticMarkup(<SessionSidebar
    projectControls={<select aria-label="Project"><option>Alpha</option></select>}
    sessions={sessions}
    scheduledChatIds={scheduledChatIds}
    currentId="pin" canBranch={false} onResume={() => undefined}
    onNew={() => undefined} onBranch={() => undefined}
    onDelete={() => undefined} onSetFlags={() => undefined}
  />);
}

describe('SessionSidebar', () => {
  it('marks chats with active schedules using a named clock without changing their title', () => {
    const html = render(new Set(['pin']));

    expect(html.match(/aria-label="Has active scheduled runs or background tools"/g)).toHaveLength(1);
    expect(html).toContain('Pinned conversation');
    expect(render()).not.toContain('Has active scheduled runs or background tools');
  });
  it('requires a separate destructive action and offers a safe cancel button', () => {
    const html = renderToStaticMarkup(<DeleteChatDialog title="A saved investigation" onClose={() => undefined} onDelete={() => undefined} />);
    expect(html).toContain('<dialog');
    expect(html).toContain('A saved investigation');
    expect(html).toContain('cannot be undone');
    expect(html.indexOf('Cancel')).toBeLessThan(html.indexOf('>Delete chat<'));
  });
  it('separates pinned and recent chats while hiding archived chats in the active view', () => {
    const html = render();
    expect(html).toContain('aria-label="Project"');
    expect(html).not.toContain('>Chats</h2>');
    expect(html.indexOf('aria-label="Project"')).toBeLessThan(html.indexOf('New chat'));
    expect(html).toContain('Pinned conversation');
    expect(html).toContain('Recent conversation');
    expect(html).not.toContain('Archived conversation');
    expect(html).not.toContain('Search all chats');
    expect(html.indexOf('Pinned conversation')).toBeLessThan(html.indexOf('Recent conversation'));
    expect(html).toContain('aria-label="Actions for Pinned conversation"');
    expect(html).not.toContain('aria-label="Archive chat"');
  });

  it('shows reversible options and delete in the single actions menu', () => {
    const html = renderToStaticMarkup(<SessionActionsMenu session={sessions[0]!} onAction={() => undefined} />);
    expect(html).toContain('Unarchive');
    expect(html).toContain('Pin');
    expect(html).toContain('Delete');
    expect(renderToStaticMarkup(<SessionActionsMenu session={sessions[1]!} onAction={() => undefined} />)).toContain('Unpin');
  });
});
