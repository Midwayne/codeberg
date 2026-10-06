import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { discoverSkills } from '../core/context/skills.js';
import { mcpConfigFromEnv } from '../core/mcp/config.js';
import { ExtensionStore, previewSkillFiles } from './extensions.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it('adds global and project MCPs and skills with project precedence and no sibling discovery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'extensions-'));
  dirs.push(home);
  const a = join(home, 'projects', 'a');
  const b = join(home, 'projects', 'b');
  const store = new ExtensionStore(home);
  await store.add(a, {
    scope: 'global',
    kind: 'mcp',
    name: 'search',
    config: { command: 'global' },
  });
  await store.add(a, {
    scope: 'project',
    kind: 'mcp',
    name: 'search',
    config: { command: 'project' },
  });
  await store.add(a, {
    scope: 'project',
    kind: 'skill',
    name: 'review',
    content: '---\nname: review\ndescription: Project review\n---\nReview this project.',
  });
  await store.add(a, {
    scope: 'global',
    kind: 'skill',
    name: 'review',
    content: '---\nname: review\ndescription: Global review\n---\nReview.',
  });
  expect(
    mcpConfigFromEnv({ CODEBERG_HOME: home, CODEBERG_ROOT: home, CODEBERG_PROJECT_HOME: a })
      .servers[0],
  ).toMatchObject({ command: 'project' });
  expect(
    mcpConfigFromEnv({ CODEBERG_HOME: home, CODEBERG_ROOT: home, CODEBERG_PROJECT_HOME: b })
      .servers[0],
  ).toMatchObject({ command: 'global' });
  expect(
    (
      await discoverSkills({
        env: { CODEBERG_HOME: home, CODEBERG_ROOT: home, CODEBERG_PROJECT_HOME: a },
        userRoots: [join(home, 'skills')],
      })
    )[0]?.description,
  ).toBe('Project review');
  expect(await readFile(join(a, 'mcp.json'), 'utf8')).toContain('project');
  await expect(
    store.add(a, { scope: 'project', kind: 'skill', name: '../escape', content: 'no' }),
  ).rejects.toThrow();
  await expect(
    store.add(a, { scope: 'project', kind: 'mcp', name: 'bad', config: {} }),
  ).rejects.toThrow();
  await expect(
    store.add(a, {
      scope: 'project',
      kind: 'mcp',
      name: 'search',
      config: { command: 'overwrite' },
    }),
  ).rejects.toThrow('already exists');
});

it('previews dropped skill documents using the existing YAML parser', () => {
  const files = previewSkillFiles({
    files: [
      {
        filename: 'SKILL.md',
        content:
          '\uFEFF---\nname: "review"\ndescription: |\n  Review safely.\n  Preserve behavior.\n---\n\nInstructions.',
      },
      { filename: 'notes.md', content: '# Notes\n\nSummarize changes.' },
      { filename: 'SKILL.md', content: 'Missing a skill name.' },
      { filename: 'SKILL.md', content: '---\nname: ../escape\ndescription: invalid\n---\nNo.' },
      { filename: 'SKILL.md', content: '---\nname: review\ndescription: duplicate\n---\nNo.' },
      { filename: 'script.sh', content: 'echo no' },
    ],
  });

  expect(files[0]).toMatchObject({
    filename: 'SKILL.md',
    name: 'review',
    description: 'Review safely.\nPreserve behavior.',
  });
  expect(files[1]).toMatchObject({ name: 'notes', description: 'Summarize changes.' });
  expect(files[2]?.error).toContain('name');
  expect(files[3]?.error).toContain('name');
  expect(files[4]?.error).toContain('same name');
  expect(files[5]?.error).toContain('Markdown');
  expect(() => previewSkillFiles({ files: Array.from({ length: 21 }, () => ({})) })).toThrow('20');
  expect(
    previewSkillFiles({ files: [{ filename: 'large.md', content: 'é'.repeat(140000) }] })[0]?.error,
  ).toContain('256 KB');
});

it('preserves imported skill contents and rejects overwrites and oversized UTF-8 documents', async () => {
  const home = await mkdtemp(join(tmpdir(), 'skill-import-'));
  dirs.push(home);
  const a = join(home, 'projects', 'a');
  const b = join(home, 'projects', 'b');
  const store = new ExtensionStore(home);
  const content =
    '---\nname: imported\ndescription: Imported review\nallowed-tools: Read\n---\n\nKeep every instruction.\n';
  await store.add(a, { scope: 'project', kind: 'skill', name: 'imported', content });
  expect(await readFile(join(a, 'skills', 'imported', 'SKILL.md'), 'utf8')).toBe(content);
  await expect(readFile(join(b, 'skills', 'imported', 'SKILL.md'), 'utf8')).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(
    store.add(a, {
      scope: 'project',
      kind: 'skill',
      name: 'imported',
      content: content + 'overwrite',
    }),
  ).rejects.toThrow('already exists');
  await expect(
    store.add(a, {
      scope: 'global',
      kind: 'skill',
      name: 'large',
      content: '---\nname: large\ndescription: Large\n---\n' + 'é'.repeat(140000),
    }),
  ).rejects.toThrow('256 KB');
});

it.each(['global', 'project'])(
  'validates %s MCP env files in their config directory using the selected repository',
  async (scope) => {
    const home = await mkdtemp(join(tmpdir(), 'extensions-env-'));
    dirs.push(home);
    const projectHome = join(home, 'projects', 'a');
    const repository = join(home, 'repository');
    await mkdir(projectHome, { recursive: true });
    await mkdir(repository);
    const configRoot = scope === 'global' ? home : projectHome;
    await writeFile(join(configRoot, '.env'), 'REVIEW_ENDPOINT=https://example.com/mcp\n');
    const env = {
      CODEBERG_HOME: home,
      CODEBERG_PROJECT_HOME: projectHome,
      CODEBERG_ROOT: repository,
    };

    const store = new ExtensionStore(home);
    const config = { command: 'node', envFile: '.env' };
    await store.add(projectHome, { scope, kind: 'mcp', name: 'endpoint', config }, env);
    const discovered = mcpConfigFromEnv(env);
    expect(discovered.warnings).toEqual([]);
    expect(discovered.servers[0]).toMatchObject({
      name: 'endpoint',
      env: { REVIEW_ENDPOINT: 'https://example.com/mcp' },
    });
    expect(
      JSON.parse(await readFile(join(configRoot, 'mcp.json'), 'utf8')).mcpServers.endpoint,
    ).toEqual(config);
    await writeFile(
      join(repository, 'repository.env'),
      'REVIEW_URL=https://example.com/repository\n',
    );
    await store.add(
      projectHome,
      {
        scope,
        kind: 'mcp',
        name: 'repository',
        config: {
          command: 'node',
          envFile: '${workspaceFolder}/repository.env',
        },
      },
      env,
    );
    expect(
      mcpConfigFromEnv(env).servers.find((server) => server.name === 'repository'),
    ).toMatchObject({ env: { REVIEW_URL: 'https://example.com/repository' } });
  },
);
