import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('@/components/workspace/workspace', () => ({ Workspace: () => <div /> }));

describe('header settings controls', () => {
  it('provides separate model picker and settings buttons in the main header', () => {
    const html = renderToStaticMarkup(<App />);
    const header = html.split('</header>')[0];
    expect(header).toContain('aria-label="Model settings"');
    expect(header).toContain('aria-label="Settings"');
    expect(header).toContain('Codeberg');
    expect(header).not.toContain('aria-label="Project"');
    expect(header).not.toContain('aria-label="MCPs and skills"');
    expect(header).toContain('aria-controls="chat-sidebar"');
  });
});
