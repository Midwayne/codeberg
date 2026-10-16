import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = process.env.BENCH_URL ?? 'http://127.0.0.1:5174/bench/cancel-activation.html';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const errors = [];

try {
  for (const cached of [false, true]) {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    const target = new URL(url);
    target.searchParams.set('cached', cached ? '1' : '0');
    await page.goto(target.href);
    await page.getByRole('button', { name: 'Open next chat' }).click();
    await page.waitForFunction(() => document.body.dataset.activationRender === 'started');
    assert.equal(await page.getByLabel('Active chat').innerText(), 'previous');
    assert.equal(await page.locator('.ui-loading-scaffold').isVisible(), true);
    assert.equal(await page.evaluate(() => document.body.dataset.historyRequests), cached ? '0' : '1');

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.getByLabel('Active chat').innerText(), 'previous');
    await page.getByRole('button', { name: 'Finish queued render' }).click();
    await page.waitForTimeout(200); // Allow the previously suspended transition to finish.

    assert.equal(await page.getByLabel('Active chat').innerText(), 'previous');
    assert.equal(await page.evaluate(() => document.body.dataset.registryChat), 'previous');
    await page.close();
  }
  for (const cancel of [true, false]) {
    const page = await browser.newPage();
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(url);
    await page.getByRole('button', { name: 'Open next chat' }).click();
    await page.waitForFunction(() => document.body.dataset.activationRender === 'started');

    await page.getByRole('button', { name: 'Open second chat' }).click();
    await page.getByRole('heading', { name: 'second', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Finish queued render' }).click();
    await page.waitForTimeout(200); // Let the superseded first transition retry.
    assert.equal(await page.getByLabel('Active chat').innerText(), 'previous');

    if (cancel) await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Finish second request' }).click();
    await page.waitForFunction((id) => document.body.dataset.committedChat === id, cancel ? 'previous' : 'second');
    await page.waitForTimeout(100); // Also check after any stale request continuation.

    assert.equal(await page.getByLabel('Active chat').innerText(), cancel ? 'previous' : 'second');
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Skeletons and cancellation for new/evicted views; a second selection supersedes the first queued activation.');
} finally {
  await browser.close();
}
