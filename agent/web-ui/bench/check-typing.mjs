import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = process.env.BENCH_URL ?? 'http://127.0.0.1:5174/bench/index.html';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url);
  await page.getByRole('heading', { name: 'Finding 199' }).waitFor();
  await page.getByRole('button', { name: 'Run five trials' }).click();
  await page.getByLabel('Benchmark results').filter({ hasText: 'draftIsolation' }).waitFor();

  const result = JSON.parse(await page.getByLabel('Benchmark results').innerText());
  console.log(JSON.stringify(result));
  assert.equal(result.draftIsolation, 'PASS');
  assert.deepEqual(result.transcriptReads, [0, 0, 0, 0, 0]);
  assert.equal(result.draft, `Draft 4: ${'x'.repeat(25)}`);
  assert.deepEqual(errors, []);
  console.log('PASS: Draft edits preserve their value without reading transcript content.');
} finally {
  await browser.close();
}
