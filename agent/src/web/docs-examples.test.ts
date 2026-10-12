import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseMcpJson } from '../core/mcp/config.js';
import { parseSkillDocument } from '../core/context/skills.js';
import { loadModelCatalog } from './model-selection/catalog.js';

async function example(topic: string, language: string) {
  const path = new URL(`../../web-ui/src/docs/content/${topic}.md`, import.meta.url);
  const content = await readFile(path, 'utf8');
  const match = new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```').exec(content);

  if (!match) throw new Error(`No ${language} example in ${topic}`);

  return match[1]!;
}

it('publishes a model catalog that passes real configuration validation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codeberg-docs-models-'));
  try {
    const catalogPath = join(home, 'models.yml');
    await writeFile(catalogPath, await example('models', 'yaml'));
    const models = await loadModelCatalog({
      catalogPath,
      defaultChat: { key: '', effort: 'provider-default' },
      defaultLearning: { key: '', effort: 'provider-default' },
      availableProvider: () => true,
    });

    expect(models[0]?.key).toBe('openai:everyday');
    expect(models[0]?.inputs).toContain('vision');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

it('publishes valid MCP and skill examples', async () => {
  const server = JSON.parse(await example('mcps', 'json'));
  const mcp = parseMcpJson(JSON.stringify({ mcpServers: { example: server } }), {
    env: { MCP_TOKEN: 'example-only' },
    userHome: '/home/example',
    workspaceFolder: '/work/example',
  });

  expect(mcp.warnings).toEqual([]);
  expect(mcp.servers).toHaveLength(1);
  expect(parseSkillDocument(await example('skills', 'md'), 'review-api-change')?.name).toBe('review-api-change');
});
