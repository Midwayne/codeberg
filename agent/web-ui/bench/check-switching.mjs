import assert from 'node:assert/strict';

// Optional browser harness; Playwright is supplied by the caller, not the app.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = process.env.BENCH_URL ?? 'http://127.0.0.1:5174/bench/switching.html';

const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const errors = [];

async function selectSyntheticChat(page, index) {
  await page.getByTitle(`Synthetic chat ${index}`, { exact: true }).click();
  await page.locator(`[data-message-id="switch-${index}-0"]`).waitFor({ state: 'visible' });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url);
  await page.getByTitle('Synthetic chat 1', { exact: true }).click();
  await page.getByTitle('Synthetic chat 0', { exact: true }).click();
  await page.getByRole('heading', { name: 'Finding 199' }).waitFor();
  await page.getByRole('button', { name: 'Run five trials' }).click();
  await page.getByLabel('Benchmark results').filter({ hasText: 'medianMsPerSwitch' }).waitFor();
  console.log(JSON.stringify({ benchmark: JSON.parse(await page.getByLabel('Benchmark results').innerText()), errors }));

  await page.getByTitle('Synthetic chat 0', { exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Draft belongs to chat zero');
  const original = await page.locator('[data-message-id="switch-0-0"]').elementHandle();
  const scroll = page.locator('[data-message-id="switch-0-0"]').locator('../..');
  await scroll.evaluate((element) => { element.scrollTop = 500; });
  await page.getByTitle('Synthetic chat 1', { exact: true }).click();
  assert.equal(await composer.inputValue(), '');
  await composer.fill('Draft belongs to chat one');
  await page.getByRole('button', { name: 'Update chat 0 in background' }).click();
  await page.getByTitle('Synthetic chat 0', { exact: true }).click();
  assert.equal(await composer.inputValue(), 'Draft belongs to chat zero');
  assert.equal(await original.evaluate((element) => element.isConnected), true);
  assert.equal(await scroll.evaluate((element) => element.scrollTop), 500);
  await page.getByText('Background response arrived.', { exact: true }).waitFor();

  for (const index of [2, 3, 4]) {
    await selectSyntheticChat(page, index);
  }
  assert.equal(await original.evaluate((element) => element.isConnected), false);
  assert.equal(await page.locator('[data-message-id$="-0"]').count(), 3);
  await selectSyntheticChat(page, 0);
  assert.equal(await composer.inputValue(), 'Draft belongs to chat zero');
  await page.getByText('Background response arrived.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clean up chat 0' }).click();
  assert.equal(await composer.inputValue(), '');
  assert.equal(await page.locator('[data-message-id="switch-0-0"]').count(), 0);

  await composer.fill('Previous chat draft');
  await page.getByTitle('Cold saved chat', { exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Loading chat…' }).waitFor();
  assert.equal(await page.getByTitle('Cold saved chat', { exact: true }).getAttribute('aria-current'), 'true');
  assert.equal(await composer.count(), 0);
  if (process.env.BENCH_SCREENSHOTS_DIR) {
    await page.screenshot({ path: `${process.env.BENCH_SCREENSHOTS_DIR}/first-open-desktop.png` });
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await composer.inputValue(), 'Previous chat draft');
  await page.getByTitle('Cold saved chat', { exact: true }).click();
  await composer.waitFor();
  assert.equal(await composer.inputValue(), '');
  assert.equal(await page.getByTitle('Cold saved chat', { exact: true }).getAttribute('aria-current'), 'true');

  await page.getByTitle('Retry saved chat', { exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not load chat (500)' }).waitFor();
  assert.equal(await composer.count(), 0);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Loading chat…' }).waitFor();
  await composer.waitFor();

  await page.getByTitle('Missing saved chat', { exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This chat no longer exists.' }).waitFor();
  await page.getByRole('button', { name: 'Back to previous chat' }).click();
  assert.equal(await page.getByTitle('Retry saved chat', { exact: true }).getAttribute('aria-current'), 'true');

  await page.getByTitle('Missing saved chat', { exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Loading chat…' }).waitFor();
  await page.getByTitle('Synthetic chat 1', { exact: true }).click();
  await page.waitForTimeout(1700); // Let the abandoned fixture request finish.
  assert.equal(await page.getByTitle('Synthetic chat 1', { exact: true }).getAttribute('aria-current'), 'true');
  assert.equal(await page.getByRole('alert').count(), 0);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  mobile.on('pageerror', (error) => errors.push(String(error)));
  await mobile.goto(url);
  await mobile.getByTitle('Synthetic chat 0', { exact: true }).click();
  const mobileComposer = mobile.getByRole('textbox', { name: 'Message', exact: true });
  await mobileComposer.fill('Mobile draft zero');
  await mobile.getByRole('button', { name: 'Show chats' }).click();
  await mobile.getByTitle('Synthetic chat 1', { exact: true }).click();
  assert.equal(await mobileComposer.inputValue(), '');
  await mobile.getByRole('button', { name: 'Show chats' }).click();
  await mobile.getByTitle('Synthetic chat 0', { exact: true }).focus();
  await mobile.keyboard.press('Enter');
  assert.equal(await mobileComposer.inputValue(), 'Mobile draft zero');
  assert.equal(await mobile.getByRole('dialog').count(), 0);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.getByRole('button', { name: 'Show chats' }).click();
  await mobile.getByTitle('Cold saved chat', { exact: true }).click();
  await mobile.getByRole('status').filter({ hasText: 'Loading chat…' }).waitFor();
  assert.equal(await mobileComposer.count(), 0);
  if (process.env.BENCH_SCREENSHOTS_DIR) {
    await mobile.screenshot({ path: `${process.env.BENCH_SCREENSHOTS_DIR}/first-open-mobile.png` });
  }
  await mobile.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await mobileComposer.inputValue(), 'Mobile draft zero');

  for (const index of [2, 3, 4]) {
    await mobile.getByRole('button', { name: 'Show chats' }).click();
    await selectSyntheticChat(mobile, index);
  }
  await mobile.getByRole('button', { name: 'Show chats' }).click();
  await mobile.getByTitle('Synthetic chat 0', { exact: true }).click();
  await mobile.getByRole('status').filter({ hasText: 'Loading chat…' }).waitFor();
  assert.equal(await mobileComposer.count(), 0);
  await mobileComposer.waitFor();
  assert.equal(await mobileComposer.inputValue(), 'Mobile draft zero');

  assert.deepEqual(errors, []);
  console.log('PASS: draft and scroll retention, background updates, eviction, cleanup, first-load feedback, cancellation, retry, missing chats, stale responses, mobile keyboard and reduced motion.');
} finally {
  await browser.close();
}
