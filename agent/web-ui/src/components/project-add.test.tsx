import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { AddProjectView } from './project-add';
import type { AddProjectViewProps } from './projects';

const teamA = { id: 'p-1', name: 'Team A', roots: [{ key: 'team-a', root: '/work/team-a' }] };

function render(overrides: Partial<AddProjectViewProps>) {
  const state: AddProjectViewProps = {
    onClose: () => undefined,
    choosing: false,
    busy: false,
    root: '/work/team-a',
    name: '',
    chooseFolder: async () => undefined,
    directoryInput: createRef<HTMLInputElement>(),
    setRoot: () => undefined,
    setName: () => undefined,
    error: '',
    existing: undefined,
    submit: () => undefined,
    preview: undefined,
    ignored: [],
    toggleRepository: () => undefined,
    setIgnored: () => undefined,
    ...overrides,
  };

  return renderToStaticMarkup(<AddProjectView {...state} />);
}

it('offers to add a new directory', () => {
  const html = render({});

  expect(html).toContain('Add project');
  expect(html).not.toContain('already belongs to');
});

it('says which project already uses the directory and only offers to finish', () => {
  const html = render({ existing: teamA });

  expect(html).toContain('This directory already belongs to <strong>Team A</strong>, so Codeberg switched to it.');
  expect(html).toContain('>Done</button>');
  expect(html).not.toContain('type="submit"');
});
