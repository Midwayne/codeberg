import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('documents every supported launcher configuration key and provider passthrough', async () => {
  const root = new URL('../../../', import.meta.url);
  const [config, setter, reference] = await Promise.all([
    readFile(new URL('launcher/internal/config/config.go', root), 'utf8'),
    readFile(new URL('launcher/internal/config/setter.go', root), 'utf8'),
    readFile(new URL('agent/web-ui/src/docs/content/environment.md', root), 'utf8'),
  ]);
  const constants = new Map([...config.matchAll(/(Key\w+)\s*=\s*"([A-Z_]+)"/g)]
    .map((match) => [match[1]!, match[2]!]));
  const known = setter.slice(setter.indexOf('keys := []string{'), setter.indexOf('keys = append'));
  const passthrough = config.slice(config.indexOf('var passthroughKeys'), config.indexOf('// Overrides'));
  const keys = [...known.matchAll(/\bKey\w+\b/g)].map((match) => constants.get(match[0])!);
  keys.push(...[...passthrough.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]!));

  expect(keys.length).toBeGreaterThan(30);
  for (const key of keys) expect(reference, `Missing launcher key ${key}`).toContain('`' + key + '`');
});
