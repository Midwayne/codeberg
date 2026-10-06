import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../', import.meta.url)) });

function functionBody(lines) {
  return Array.from({ length: lines }, () => '  value += 1;').join('\n');
}

async function lint(code, filePath = 'src/lint-fixture.ts') {
  const [result] = await eslint.lintText(code, { filePath });
  return result;
}

test('allows exactly 50 lines and rejects 51 lines', async () => {
  const atLimit = `function example(value: number) {\n${functionBody(48)}\n}`;
  const overLimit = `function example(value: number) {\n${functionBody(49)}\n}`;
  assert.equal((await lint(atLimit)).errorCount, 0);
  const result = await lint(overLimit);
  assert.equal(result.errorCount, 1);
  assert.equal(result.messages[0].ruleId, 'max-lines-per-function');
  assert.equal(result.messages[0].severity, 2);
});

test('counts blank lines and comment-only lines', async () => {
  const body = `${functionBody(47)}\n\n  // Still part of the function.`;
  assert.equal((await lint(`function example(value: number) {\n${body}\n}`)).errorCount, 1);
});

test('checks arrow functions, class methods, and immediately invoked functions', async () => {
  const body = functionBody(49);
  const examples = [
    `const example = (value: number) => {\n${body}\n};`,
    `class Example {\n  method(value: number) {\n${body}\n  }\n}`,
    `((value: number) => {\n${body}\n})(0);`,
  ];
  for (const code of examples) assert.equal((await lint(code)).errorCount, 1);
});

test('ignores backend tests, frontend files, and generated output', async () => {
  const code = `function example(value: number) {\n${functionBody(49)}\n}`;
  for (const filePath of ['src/example.test.ts', 'web-ui/src/example.ts', 'dist/example.ts']) {
    assert.equal(await eslint.isPathIgnored(filePath), true);
    assert.equal((await lint(code, filePath)).errorCount, 0);
  }
});
