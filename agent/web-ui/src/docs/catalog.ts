import gettingStarted from './content/getting-started.md?raw';
import models from './content/models.md?raw';
import configuration from './content/configuration.md?raw';
import environment from './content/environment.md?raw';
import mcps from './content/mcps.md?raw';
import skills from './content/skills.md?raw';
import projects from './content/projects.md?raw';
import indexing from './content/indexing.md?raw';
import tools from './content/tools.md?raw';
import learning from './content/learning.md?raw';
import storage from './content/storage.md?raw';
import troubleshooting from './content/troubleshooting.md?raw';

export type DocPage = {
  id: string;
  title: string;
  group: 'Setup' | 'Concepts' | 'Guides';
  summary: string;
  content: string;
};

export const docPages: DocPage[] = [
  { id: 'getting-started', title: 'Getting started', group: 'Setup', content: gettingStarted,
    summary: 'Open Codeberg, configure a model, and ask your first question.' },
  { id: 'models', title: 'Models and credentials', group: 'Setup', content: models,
    summary: 'Connect a provider and choose chat and learning models.' },
  { id: 'configuration', title: 'Configuration', group: 'Setup', content: configuration,
    summary: 'Find your config files and understand which settings take precedence.' },
  { id: 'environment', title: 'Environment variables', group: 'Setup', content: environment,
    summary: 'Choose startup settings, provider credentials, tool switches, and indexing options.' },
  { id: 'mcps', title: 'MCP servers', group: 'Setup', content: mcps,
    summary: 'Connect external tools for one project or all projects.' },
  { id: 'skills', title: 'Skills', group: 'Setup', content: skills,
    summary: 'Give the agent reusable instructions and import existing skills.' },
  { id: 'projects', title: 'Projects', group: 'Concepts', content: projects,
    summary: 'Understand project selection, isolation, and saved history.' },
  { id: 'indexing', title: 'Indexing and search', group: 'Concepts', content: indexing,
    summary: 'How source files become searchable chunks and vectors.' },
  { id: 'tools', title: 'Tools and answers', group: 'Concepts', content: tools,
    summary: 'What the agent can read, how it searches, and how to inspect evidence.' },
  { id: 'learning', title: 'Learning and knowledge', group: 'Concepts', content: learning,
    summary: 'Control background learning, saved knowledge, and model usage.' },
  { id: 'storage', title: 'Data and maintenance', group: 'Guides', content: storage,
    summary: 'Know what is stored, what leaves your machine, and how to clean up.' },
  { id: 'troubleshooting', title: 'Troubleshooting', group: 'Guides', content: troubleshooting,
    summary: 'Recover from missing models, indexing failures, and extension errors.' },
];

export const docGroups = ['Setup', 'Concepts', 'Guides'] as const;

export function findDocPage(path: string): DocPage | undefined {
  const id = path.replace(/^\/docs\/?/, '').replace(/\/$/, '') || 'getting-started';

  return docPages.find((page) => page.id === id);
}

export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

export function documentHeadings(markdown: string): { id: string; title: string }[] {
  let fenced = false;
  const headings: { id: string; title: string }[] = [];

  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    if (fenced) continue;

    const match = /^## (.+)$/.exec(line);
    if (match) headings.push({ id: headingId(match[1]!), title: match[1]! });
  }

  return headings;
}
