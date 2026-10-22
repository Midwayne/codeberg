import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const base = process.env.BENCH_URL ?? 'http://127.0.0.1:5176/bench/scrolling.html';
const errors = [];

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function gap(root) {
  return root.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
}

try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(base);
    const root = page.locator('[data-message-id="question"]').locator('../..');
    await root.waitFor();
    await page.getByRole('button', { name: 'Stream response', exact: true }).click();
    await page.locator('[data-message-id="answer-1"] p').first().waitFor();
    await settle(page);
    assert.ok(await gap(root) <= 1, `Streaming lost the bottom at ${width}px: ${await gap(root)}px`);

    await page.getByRole('button', { name: 'Complete response', exact: true }).click();
    await page.locator('[data-message-id="answer-1"]').evaluate((element) => {
      const delayedContent = document.createElement('div');
      delayedContent.style.height = '600px';
      delayedContent.textContent = 'Delayed markdown or image layout';
      element.append(delayedContent);
    });
    await settle(page);
    assert.ok(await gap(root) <= 1, `Delayed layout lost the bottom at ${width}px: ${await gap(root)}px`);

    const bounds = await root.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(200);
    const readingTop = await root.evaluate((element) => element.scrollTop);
    assert.ok(await gap(root) > 120, 'Manual upward scrolling must remain possible');
    await page.getByRole('button', { name: 'Stream response', exact: true }).click();
    await page.locator('[data-message-id="answer-2"] p').first().waitFor();
    await settle(page);
    assert.ok(Math.abs(await root.evaluate((element) => element.scrollTop) - readingTop) < 1,
      'New responses must preserve a reader scrolling through history');

    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 100000);
    await page.waitForTimeout(200);
    assert.ok(await gap(root) <= 1, `Manual scroll stopped short at ${width}px: ${await gap(root)}px`);
    await page.getByRole('button', { name: 'Complete response', exact: true }).click();
    await settle(page);
    assert.ok(await gap(root) <= 1);
    await page.screenshot({ path: `/tmp/codeberg-scroll-${width}.png` });
    await page.close();
    console.log(`PASS ${width}px: streaming, delayed layout, reading history, manual bottom, completion`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
