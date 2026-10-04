import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AddProject, ProjectDetails, RenameProjectForm } from './projects';

it('offers the native folder picker alongside manual directory entry', () => {
  const html = renderToStaticMarkup(<AddProject onClose={() => undefined} onAdded={async () => undefined} />);
  expect(html).toContain('Choose folder');
  expect(html).toContain('Directory path');
  expect(html).toMatch(/<button[^>]*aria-label="Choose folder"/);
  expect(html).toContain('aria-label="Project directory"');
  expect(html).not.toContain('Browse folders');
  expect(html).not.toContain('Filter folders');
  expect(html).not.toContain('Choose a directory on the computer running Codeberg.');
});

it('makes each project identifiable before opening its rename form and exposes copyable config locations', () => {
 const project={id:'p-0123456789abcdef',name:'My workspace',roots:[{key:'api',root:'/work/api'},{key:'ui',root:'/work/ui'}],configDirectory:'/custom/codeberg/projects/p-0123456789abcdef'};
 const html=renderToStaticMarkup(<ProjectDetails project={project} current onRenamed={() => undefined} />);
 expect(html).toMatch(/<h3[^>]*>My workspace<\/h3>/);
 expect(html).toContain('Current project');
 expect(html).toContain('Rename My workspace');
 expect(html).not.toContain('<input');
 expect(html).toContain('Directory');
 expect(html).toContain('/work/api');expect(html).toContain('/work/ui');
 expect(html).toContain('Project ID');expect(html).toContain(project.id);
 expect(html).toContain('Config directory');expect(html).toContain(project.configDirectory);
 expect(html).toContain('Copy project ID');
 expect(html).toContain('Copy config directory');
 expect(html).toContain('Copy directory path');
});

it('keeps rename validation and cancellation in a focused inline form', () => {
 const html=renderToStaticMarkup(<RenameProjectForm project={{id:'p-0123456789abcdef',name:'My workspace',roots:[]}} onRenamed={() => undefined} onCancel={() => undefined} />);
 expect(html).toContain('Project name');
 expect(html).toContain('Save name');
 expect(html).toContain('Cancel');
 expect(html).toContain('maxLength="120"');
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save name<\/button>/);
});
