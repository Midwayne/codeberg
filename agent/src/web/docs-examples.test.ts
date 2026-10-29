import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseMcpJson } from '../core/mcp/config.js';
import { parseSkillDocument } from '../core/context/skills.js';
import { loadModelCatalog } from './model-selection/catalog.js';
import { loadDecisionCatalog } from '../core/decisions/catalog.js';
import { parse, stringify } from 'yaml';

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

it('publishes decision catalog overlays that work with the text-model example', async () => {
  const path = new URL('../../web-ui/src/docs/content/models.md', import.meta.url);
  const content = await readFile(path, 'utf8');
  const blocks = [...content.matchAll(/```yaml\n([\s\S]*?)\n```/g)].map((match) => parse(match[1]!));
  const catalog = blocks[0];
  for (const overlay of blocks.slice(1)) {
    catalog.decisions ??= overlay.decisions;
    for (const [provider, definition] of Object.entries(overlay.providers)) {
      catalog.providers[provider] = { ...catalog.providers[provider], ...definition as object };
    }
  }

  const home = await mkdtemp(join(tmpdir(), 'codeberg-docs-decisions-'));
  try {
    const catalogPath = join(home, 'models.yml');
    await writeFile(catalogPath, stringify(catalog));
    const loaded = await loadDecisionCatalog(catalogPath, {
      OPENAI_API_KEY: 'test', TYPESAFE_API_KEY: 'test', OPENROUTER_API_KEY: 'test', CLOUDFLARE_API_TOKEN: 'test',
    });

    expect(loaded.decisionModels).toHaveLength(4);
    expect(loaded.decisions).toBe('openai:fast');
    expect((await loadModelCatalog({ catalogPath, defaultChat: { key: '', effort: 'none' },
      defaultLearning: { key: '', effort: 'none' } }))[0]?.key).toBe('openai:everyday');
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
