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

test('allows 199 file lines and rejects 200, including a final newline', async () => {
  const atLimit = 'export {};\n' + Array.from({ length: 198 }, () => '// File content.').join('\n');
  const overLimit = atLimit + '\n// One line too many.';

  for (const ending of ['', '\n']) {
    assert.equal((await lint(atLimit + ending)).errorCount, 0);
    const result = await lint(overLimit + ending);
    assert.equal(result.errorCount, 1);
    assert.equal(result.messages[0].ruleId, 'max-lines');
    assert.equal(result.messages[0].severity, 2);
  }
});

test('counts blank and comment-only lines toward the file limit', async () => {
  const code = 'export {};\n' + Array.from({ length: 199 }, (_, i) => (i % 2 ? '' : '// Comment.')).join('\n');
  assert.equal(
    (await lint(code)).messages.some((message) => message.ruleId === 'max-lines'),
    true,
  );
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

test('ignores tests and generated output in both packages', async () => {
  const code = `function example(value: number) {\n${functionBody(49)}\n}`;
  for (const filePath of [
    'src/example.test.ts',
    'web-ui/src/example.test.tsx',
    'web-ui/dist/example.ts',
    'dist/example.ts',
  ]) {
    assert.equal(await eslint.isPathIgnored(filePath), true);
    assert.equal((await lint(code, filePath)).errorCount, 0);
  }
});

for (const filePath of ['web-ui/src/example.ts', 'web-ui/src/example.tsx']) {
  test(`enforces function limits in ${filePath}`, async () => {
    const code = `function example(value: number) {\n${functionBody(49)}\n}`;
    assert.equal(await eslint.isPathIgnored(filePath), false);
    assert.equal((await lint(code, filePath)).messages[0].ruleId, 'max-lines-per-function');
  });
}

test('enforces file limits in TSX, counting comments and whitespace', async () => {
  const code =
    'export const View = () => <div />;\n' +
    Array.from({ length: 199 }, (_, i) => (i % 2 ? '' : '// Comment.')).join('\n');
  assert.equal((await lint(code, 'web-ui/src/example.tsx')).messages[0].ruleId, 'max-lines');
});

test('rejects trailing whitespace and packed statements', async () => {
  for (const filePath of ['src/example.ts', 'web-ui/src/example.tsx']) {
    const result = await lint('const one = 1; const two = 2;  \n', filePath);
    assert.ok(result.messages.some(({ ruleId }) => ruleId === 'no-trailing-spaces'));
    assert.ok(result.messages.some(({ ruleId }) => ruleId === 'max-statements-per-line'));
  }
});

test('standalone frontend lint uses exactly the shared rules', async () => {
  const frontend = new ESLint({ cwd: fileURLToPath(new URL('../web-ui/', import.meta.url)) });
  const backendConfig = await eslint.calculateConfigForFile('src/example.ts');
  const frontendConfig = await frontend.calculateConfigForFile('src/example.tsx');

  assert.deepEqual(frontendConfig.rules, backendConfig.rules);
  assert.equal(await frontend.isPathIgnored('src/example.test.tsx'), true);
  assert.equal(await frontend.isPathIgnored('dist/example.tsx'), true);

  const code = `function example(value: number) {\n${functionBody(49)}\n}`;
  const [result] = await frontend.lintText(code, { filePath: 'src/example.tsx' });
  assert.equal(result.messages[0].ruleId, 'max-lines-per-function');
});

test('rejects repeated blank lines in backend and frontend sources', async () => {
  for (const filePath of ['src/example.ts', 'web-ui/src/example.tsx']) {
    const result = await lint('export {};\n\n\nconst value = 1;\n', filePath);
    assert.ok(result.messages.some(({ ruleId }) => ruleId === 'no-multiple-empty-lines'));
  }
});
