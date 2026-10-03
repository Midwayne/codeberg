import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ProjectExtensions } from './extensions';
import { ProjectApiContext } from '@/lib/project-api';

function render(kind: 'mcp' | 'skill') {
  return renderToStaticMarkup(<ProjectApiContext.Provider value={{ project: { id: 'p-0123456789abcdef', name: 'Example', roots: [{ key: 'example', root: '/example' }] }, fetch, ready: true }}><ProjectExtensions kind={kind} /></ProjectApiContext.Provider>);
}

it('gives MCPs and skills separate editors without a type dropdown', () => {
  const mcp = render('mcp');
  const skill = render('skill');
  expect(mcp).toContain('Server configuration (JSON)');
  expect(mcp).not.toContain('Instructions');
  expect(skill).toContain('Instructions');
  expect(skill).toContain('Choose skill files');
  expect(skill).toContain('Drop skill files here');
  expect(skill).not.toContain('Server configuration (JSON)');
  expect(mcp).not.toContain('<span class="block">Type</span>');
  expect(skill).not.toContain('<span class="block">Type</span>');
});
