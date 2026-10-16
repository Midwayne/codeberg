import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const url = process.env.BENCH_URL ?? 'http://127.0.0.1:5174/bench/switching.html';
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url);
  await page.getByTitle('Synthetic chat 0', { exact: true }).click();
  await page.evaluate(async () => {
    const dataUrl = (blob) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    const bytes = new Uint8Array(80_044);
    const header = new DataView(bytes.buffer);
    const ascii = (offset, text) => [...text].forEach((character, index) => {
      bytes[offset + index] = character.charCodeAt(0);
    });

    ascii(0, 'RIFF');
    header.setUint32(4, bytes.length - 8, true);
    ascii(8, 'WAVEfmt ');
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true);
    header.setUint16(22, 1, true);
    header.setUint32(24, 8000, true);
    header.setUint32(28, 8000, true);
    header.setUint16(32, 1, true);
    header.setUint16(34, 8, true);
    ascii(36, 'data');
    header.setUint32(40, bytes.length - 44, true);
    bytes.fill(128, 44);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    canvas.getContext('2d').fillRect(0, 0, 64, 64);
    await new Promise((resolve) => setTimeout(resolve, 600));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());

    window.dispatchEvent(new CustomEvent('benchmark:attach-media', { detail: [
      { type: 'file', filename: 'Synthetic audio.wav', mediaType: 'audio/wav', url: await dataUrl(new Blob([bytes], { type: 'audio/wav' })) },
      { type: 'file', filename: 'Synthetic video.webm', mediaType: 'video/webm', url: await dataUrl(new Blob(chunks, { type: 'video/webm' })) },
    ] }));
  });

  const audio = await page.locator('audio').elementHandle();
  const video = await page.locator('video').elementHandle();
  const players = [audio, video];
  for (const player of players) {
    await player.evaluate(async (element) => {
      element.muted = true;
      element.loop = true;
      await element.play();
    });
  }
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'Update chat 0 in background' }).click();
  for (const player of players) {
    assert.equal(await player.evaluate((element) => element.paused), false);
  }

  await page.getByTitle('Synthetic chat 1', { exact: true }).click();
  const stoppedAt = [];
  for (const player of players) {
    const state = await player.evaluate((element) => ({ connected: element.isConnected, paused: element.paused, time: element.currentTime }));
    assert.equal(state.connected, true);
    assert.equal(state.paused, true);
    stoppedAt.push(state.time);
  }
  await page.waitForTimeout(250);
  for (const [index, player] of players.entries()) {
    assert.ok(Math.abs(await player.evaluate((element) => element.currentTime) - stoppedAt[index]) < 0.03);
  }

  await page.getByTitle('Synthetic chat 0', { exact: true }).click();
  for (const [index, player] of players.entries()) {
    const state = await player.evaluate((element) => ({ paused: element.paused, time: element.currentTime }));
    assert.equal(state.paused, true);
    assert.ok(Math.abs(state.time - stoppedAt[index]) < 0.03);
    await player.evaluate((element) => element.play());
  }
  await page.getByTitle('Cold saved chat', { exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Loading chat…' }).waitFor();
  for (const player of players) assert.equal(await player.evaluate((element) => element.paused), true);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const player of players) assert.equal(await player.evaluate((element) => element.paused), true);

  assert.deepEqual(errors, []);
  console.log('PASS: Audio/video continue during chat updates, pause when hidden or loading another chat, retain position, and stay paused on return.');
} finally {
  await browser.close();
}
