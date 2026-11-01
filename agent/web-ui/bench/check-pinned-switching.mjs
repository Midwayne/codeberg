import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.BENCH_URL ?? 'http://127.0.0.1:5174/bench/switching.html';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const scenarios = [
  { key: 'recent', order: [0, 1], pinned: [] },
  { key: 'pinned', order: [0, 1], pinned: [0, 1] },
  { key: 'mixed', order: [0, 2], pinned: [0, 1] },
  { key: 'pinnedCycle', order: [0, 1, 3, 4], pinned: [0, 1, 3, 4] },
  { key: 'mixedCycle', order: [0, 1, 2, 3], pinned: [0, 1] },
  { key: 'eightCycle', order: [0, 1, 2, 3, 4, 5, 6, 7], pinned: [0, 1] },
];
const errors = [];

async function selectChat(page, index, group) {
  const scope = group ? page.getByRole('region', { name: group, exact: true }) : page;
  await scope.getByTitle(`Synthetic chat ${index}`, { exact: true }).click();
  await page.locator(`[data-message-id="switch-${index}-0"]`).waitFor({ state: 'visible' });
}

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(new URL(base).searchParams.get('content') === 'rich' ? 120_000 : 30_000);
    page.on('pageerror', (error) => errors.push(String(error)));
    const url = new URL(base);
    url.searchParams.set('scenario', scenario.key);
    await page.goto(url.href);
    await page.evaluate(() => {
      globalThis.skeletonLoads = 0;
      let previous;
      const observer = new MutationObserver(() => {
        const current = document.querySelector('[aria-label="Open chat"][aria-busy="true"]');
        if (current && current !== previous) globalThis.skeletonLoads++;
        previous = current;
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });

    for (const index of scenario.order) {
      const group = scenario.pinned.includes(index) ? 'Pinned' : 'Recent';
      await selectChat(page, index, group);
    }
    await page.evaluate(() => { globalThis.skeletonLoads = 0; });
    await page.getByRole('button', { name: 'Run five trials', exact: true }).click();
    const output = page.getByLabel('Benchmark results').filter({ hasText: 'medianMsPerSwitch' });
    await output.waitFor();
    const result = JSON.parse(await output.innerText());
    assert.equal(result.historyRequests, 0);
    const skeletonsDuringTrials = await page.evaluate(() => globalThis.skeletonLoads);
    assert.equal(skeletonsDuringTrials, 0, 'Warmed working sets must not show loading screens');
    assert.deepEqual(result.transcriptReads, [0, 0, 0, 0, 0], 'Warmed switches must reuse transcript content');

    await selectChat(page, 0);
    const original = await page.locator('[data-message-id="switch-0-0"]').elementHandle();

    for (const index of scenario.order.slice(1)) {
      await selectChat(page, index);
    }
    await selectChat(page, 0);
    const retained = await original.evaluate((element) => element.isConnected);
    assert.equal(retained, true);
    assert.equal(await page.getByRole('status').filter({ hasText: 'Loading chat…' }).count(), 0);
    console.log(JSON.stringify({ ...result, skeletonsDuringTrials, originalTranscriptRetained: retained }));

    if (scenario.key === 'pinned' || scenario.key === 'mixed') {
      await page.getByRole('region', { name: 'Pinned', exact: true })
        .getByTitle('Cold saved chat', { exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Loading chat…' }).waitFor();
      assert.equal(await page.getByTitle('Cold saved chat', { exact: true }).getAttribute('aria-current'), 'true');
      assert.equal(await page.locator('.ui-loading-scaffold').isVisible(), true);
      assert.equal(await page.getByRole('textbox', { name: 'Message', exact: true }).count(), 0);
      await page.getByRole('region', { name: 'Recent', exact: true })
        .getByTitle('Synthetic chat 2', { exact: true }).click();
      await page.waitForTimeout(1700); // Allow the superseded fixture GET to finish.
      assert.equal(await page.getByTitle('Synthetic chat 2', { exact: true }).getAttribute('aria-current'), 'true');
      assert.equal(await page.getByRole('status').filter({ hasText: 'Loading chat…' }).count(), 0);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: two-, four-, and eight-chat working sets retain transcript DOM without loading screens, transcript reads, or history GETs; grouped selection and stale-response isolation work.');
} finally {
  await browser.close();
}
