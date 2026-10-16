import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = new URL(process.env.BENCH_URL ?? 'http://127.0.0.1:5174/bench/switching.html');
url.searchParams.set('content', 'rich');
url.searchParams.set('scenario', 'mixed');
const cpuRate = Number(process.env.CPU_RATE ?? 1);
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const errors = [];

async function readingPosition(page) {
  return page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const target = document.querySelector('[data-message-id="switch-0-180"]');
    const root = target.parentElement.parentElement;

    return { scroll: root.scrollTop, offset: target.getBoundingClientRect().top - root.getBoundingClientRect().top };
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(120_000);
  page.on('pageerror', (error) => errors.push(String(error)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  await page.goto(url.href);
  await page.getByRole('heading', { name: 'Finding 199', exact: true }).waitFor();
  for (const index of [2, 0]) {
    await page.getByTitle(`Synthetic chat ${index}`, { exact: true }).click();
    await page.locator(`[data-message-id="switch-${index}-0"]`).waitFor({ state: 'visible' });
  }
  const first = page.locator('[data-message-id="switch-0-1"]');
  const original = await first.elementHandle();
  const activity = first.locator('details').first();
  await activity.locator('summary').first().click();
  await page.getByRole('button', { name: 'Run five trials', exact: true }).click();
  const output = page.getByLabel('Benchmark results').filter({ hasText: 'medianMsPerSwitch' });
  await output.waitFor();
  const result = JSON.parse(await output.innerText());
  console.log(JSON.stringify({ cpuRate, ...result }));

  await page.getByTitle('Synthetic chat 0', { exact: true }).click();
  assert.equal(await original.evaluate((element) => element.isConnected), true);
  assert.equal(await activity.getAttribute('open'), '');
  assert.deepEqual(result.transcriptReads, [0, 0, 0, 0, 0], 'Retained switches must reuse unchanged transcript content');
  assert.equal(result.historyRequests, 0);
  await page.getByRole('button', { name: 'Update chat 0 in background' }).click();
  await page.getByText('Background response arrived.', { exact: true }).waitFor();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const marker = page.getByRole('button', { name: 'Jump to message: Chat 0: how does request 180 reach search?', exact: true });
  await marker.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-message-id="switch-0-180"]');
    const root = target.parentElement.parentElement;
    const top = target.getBoundingClientRect().top - root.getBoundingClientRect().top;

    return top >= -1 && top < root.clientHeight;
  });
  const position = await readingPosition(page);
  for (const index of [2, 0]) {
    await page.getByTitle(`Synthetic chat ${index}`, { exact: true }).click();
    await page.locator(`[data-message-id="switch-${index}-0"]`).waitFor({ state: 'visible' });
  }
  const restored = await readingPosition(page);
  console.log(JSON.stringify({ readingPosition: { position, restored } }));
  assert.ok(Math.abs(restored.offset - position.offset) < 1, `Reading position changed: ${JSON.stringify({ position, restored })}`);

  await page.evaluate(() => {
    globalThis.savedRecords = [];
    window.addEventListener('benchmark:saved-session', (event) => globalThis.savedRecords.push(event.detail));
  });
  await page.getByTitle('Synthetic chat 2', { exact: true }).click();
  await page.locator('[data-message-id="switch-2-0"]').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Branch from here', exact: true }).first().click();
  await page.waitForFunction(() => globalThis.savedRecords.some((record) => record.parentId));
  const branch = await page.evaluate(() => globalThis.savedRecords.find((record) => record.parentId));
  assert.equal(branch.parentId, 'switch-2');
  assert.equal(branch.messages.length, 2);
  assert.equal(branch.messages[0].parts[0].text, 'Chat 2: how does request 0 reach search?');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTitle('Synthetic chat 0', { exact: true }).click();
  await page.locator('[data-message-id="switch-0-180"]').scrollIntoViewIfNeeded();
  const mobilePosition = await readingPosition(page);
  for (const index of [2, 0]) {
    await page.getByRole('button', { name: 'Show chats', exact: true }).click();
    await page.getByTitle(`Synthetic chat ${index}`, { exact: true }).click();
    await page.locator(`[data-message-id="switch-${index}-0"]`).waitFor({ state: 'visible' });
  }
  const mobileRestored = await readingPosition(page);
  console.log(JSON.stringify({ mobileReadingPosition: { position: mobilePosition, restored: mobileRestored } }));
  assert.ok(Math.abs(mobileRestored.offset - mobilePosition.offset) < 1, `Mobile reading position changed: ${JSON.stringify({ mobilePosition, mobileRestored })}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: Rich retained chats reuse transcript content, preserve disclosures and desktop/mobile reading position, support rail jumps, show new responses, and branch from the committed chat.');
} finally {
  await browser.close();
}
