import { expect, test, type Page } from '@playwright/test';
import { setup, initial, metadata, vessel } from './fixtures';

const moving = (lon = 80) => vessel('MOVE', 13, lon, 90);
const base = { ...initial, vessels: [moving()] };
const meta = { ...metadata, vessel_count: 1, vessel_ids: ['MOVE'],
  bounds: { south: 12.999, north: 13.001, west: 79.999, east: 80.001 } };
const frame = (second: number, lon: number, speed = 1, playing = true) => ({
  ...base, second, timestamp: new Date(Date.parse(base.timestamp) + second * 1000).toISOString(),
  speed, playing, vessels: [moving(lon)],
});

declare global {
  interface Window { motionClock: { now: number; next: number; callbacks: Map<number, FrameRequestCallback> } }
}
async function clock(page: Page) {
  await page.evaluate(() => {
    const state = { now: performance.now(), next: 0, callbacks: new Map<number, FrameRequestCallback>() };
    window.motionClock = state;
    performance.now = () => state.now;
    window.requestAnimationFrame = callback => { const id = ++state.next; state.callbacks.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { state.callbacks.delete(id); };
  });
}
async function advance(page: Page, ms: number) {
  await page.evaluate(ms => {
    const state = window.motionClock; state.now += ms;
    const callbacks = [...state.callbacks.values()]; state.callbacks.clear();
    callbacks.forEach(callback => callback(state.now));
  }, ms);
}
const queued = (page: Page) => page.evaluate(() => window.motionClock.callbacks.size);
const x = (page: Page) => page.getByTitle('Vessel MOVE').evaluate(element => element.getBoundingClientRect().x);

for (const speed of [1, 2, 5, 10]) {
  test(`confirmed consecutive fixes transition over ${1000 / speed}ms at ${speed}×`, async ({ page }) => {
    const server = await setup(page, { metadata: meta, frame: base });
    await clock(page);
    server.send(frame(0, 80, speed));
    await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
    const marker = await page.getByTitle('Vessel MOVE').elementHandle();
    const start = await x(page);
    server.send(frame(1, 80.0005, speed));
    await expect.poll(() => queued(page)).toBe(1);
    expect(await x(page)).toBe(start);
    await advance(page, 500 / speed);
    const middle = await x(page); expect(middle).toBeGreaterThan(start);
    await advance(page, 500 / speed);
    const end = await x(page); expect(end).toBeGreaterThan(middle);
    expect(Math.abs((middle - start) - (end - middle))).toBeLessThanOrEqual(1);
    expect(await queued(page)).toBe(0);
    expect(await marker!.evaluate(e => e === document.querySelector('[title="Vessel MOVE"]'))).toBe(true);
    // Sidebar/source observation and trail endpoint stay exact, even midway visually.
    await page.getByTitle('Vessel MOVE').click();
    await expect(page.locator('.vessel-panel')).toContainText('80.000500°');
    expect(server.commands).toEqual([]); expect(server.errors).toEqual([]);
  });
}

test('pause, reset and consecutive forward/backward seek cancel animation before acknowledgement', async ({ page }) => {
  const server = await setup(page, { metadata: meta, frame: base, autoRespond: false });
  await clock(page);
  server.send(frame(0, 80)); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  server.send(frame(1, 80.0005)); await expect.poll(() => queued(page)).toBe(1);
  await advance(page, 200);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => queued(page)).toBe(0);
  const paused = await x(page); await advance(page, 2000); expect(await x(page)).toBe(paused);
  server.send(frame(1, 80.0005, 1, false));
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeEnabled();
  server.send(frame(1, 80.0005)); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  server.send(frame(2, 80)); await expect.poll(() => queued(page)).toBe(1);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(() => queued(page)).toBe(0);
  server.send(frame(0, 80, 1, false)); await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeEnabled();
  const reset = await x(page); await advance(page, 2000); expect(await x(page)).toBe(reset);
  // A seek by exactly one second must snap too, including a batched response.
  const slider = page.getByRole('slider', { name: 'Replay position' });
  await slider.focus(); await slider.press('ArrowRight');
  server.send(frame(1, 80.0005, 1, false));
  await expect(slider).toHaveValue('1'); expect(await queued(page)).toBe(0);
  await slider.press('Home'); server.send(frame(0, 80, 1, false));
  await expect(slider).toHaveValue('0'); await advance(page, 2000); expect(await x(page)).toBe(reset);
});

test('gaps, skipped seconds, discontinuities and disconnect never blend unrelated positions', async ({ page }) => {
  const server = await setup(page, { metadata: meta, frame: base });
  await clock(page);
  server.send(frame(0, 80)); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  server.send(frame(1, 81)); await expect(page.locator('time[aria-label="Current replay time"]')).toHaveText('09:00:01');
  expect(await queued(page)).toBe(0); // >100m discontinuity, data still displayed exactly.
  server.send(frame(10, 80)); await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue('10');
  expect(await queued(page)).toBe(0);
  server.send({ ...frame(11, 80), vessels: [] }); await expect(page.getByTitle('Vessel MOVE')).toHaveCount(0);
  server.send(frame(12, 80.0005)); await expect(page.getByTitle('Vessel MOVE')).toHaveCount(1);
  expect(await queued(page)).toBe(0);
  server.send(frame(13, 80)); await expect.poll(() => queued(page)).toBe(1);
  server.close(); await expect(page.getByTitle('Vessel MOVE')).toHaveCount(0);
  expect(await queued(page)).toBe(0);
});

test('search selects absent metadata vessels locally and persists selection through observations', async ({ page }) => {
  const server = await setup(page);
  await expect(page.getByLabel('Search vessel ID')).toBeVisible();
  await page.getByLabel('Search vessel ID').fill('t015');
  const button = page.getByRole('list', { name: 'Matching vessels' }).getByRole('button');
  await expect(button).toHaveCount(1); await expect(button).toContainText('No current observation');
  const originalMarker = page.getByTitle('Vessel T007');
  const position = await originalMarker.getAttribute('style');
  await button.click(); await expect(page.locator('.vessel-panel h2')).toHaveText('T015');
  await expect(originalMarker).toHaveAttribute('style', position!);
  await expect(page.getByText('No observation at this time.', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Vessel T015')).toHaveCount(0);
  server.send({ ...initial, vessels: [...initial.vessels, vessel('T015', 13.07, 80.34)] });
  await expect(page.getByTitle('Vessel T015')).toHaveClass(/is-selected/);
  await page.getByLabel('Search vessel ID').fill('no-match');
  await expect(page.getByText('No matching vessels.', { exact: true })).toBeVisible();
  server.send(initial); await expect(page.locator('.vessel-panel h2')).toHaveText('T015');
  expect(server.commands).toEqual([]);
});

test('clicking during motion preserves animation, exact details/trails and map navigation', async ({ page }) => {
  const server = await setup(page, { metadata: meta, frame: base });
  await clock(page);
  server.send(frame(0, 80)); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  const map = await page.locator('.leaflet-container').elementHandle();
  server.send(frame(1, 80.0005)); await expect.poll(() => queued(page)).toBe(1);
  const trail = await page.locator('path.vessel-trail').getAttribute('d');
  await advance(page, 250);
  const marker = page.getByTitle('Vessel MOVE');
  const box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + 16, box.y + 16); await page.mouse.down();
  await advance(page, 100); await page.mouse.up();
  await expect(marker).toHaveClass(/is-selected/);
  await expect(page.locator('.vessel-panel')).toContainText('80.000500°');
  expect(await queued(page)).toBe(1); // Selection does not restart or cancel motion.
  await expect(page.locator('path.vessel-trail')).toHaveAttribute('d', trail!);
  const before = await x(page); await advance(page, 400); expect(await x(page)).toBeGreaterThan(before);
  const mapBox = (await page.locator('.leaflet-container').boundingBox())!;
  const view = await page.locator('.leaflet-map-pane').getAttribute('style');
  await page.mouse.move(mapBox.x + 80, mapBox.y + 80); await page.mouse.down();
  await page.mouse.move(mapBox.x + 140, mapBox.y + 130, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.leaflet-map-pane')).not.toHaveAttribute('style', view!);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await advance(page, 1000); expect(await queued(page)).toBe(0);
  expect(await map!.evaluate(e => e === document.querySelector('.leaflet-container'))).toBe(true);
  await expect(marker).toHaveClass(/is-selected/); expect(server.commands).toEqual([]);
});

test('playing seek barriers snap forward one second and backward without stale callbacks', async ({ page }) => {
  const server = await setup(page, { metadata: meta, frame: base, autoRespond: false });
  await clock(page);
  for (const target of [2, 0]) {
    server.send(frame(0, 80)); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
    server.send(frame(1, 80.0005)); await expect.poll(() => queued(page)).toBe(1);
    await advance(page, 200);
    const slider = page.getByRole('slider', { name: 'Replay position' });
    await slider.focus(); await slider.press(target ? 'ArrowRight' : 'Home');
    await expect.poll(() => queued(page)).toBe(0);
    server.send(frame(1, 80.0005, 1, false));
    await expect.poll(() => server.commands.at(-1)).toEqual({ type: 'seek', second: target });
    server.send(frame(target, 80, 1, false));
    await expect.poll(() => server.commands.at(-1)).toEqual({ type: 'play' });
    server.send(frame(target, 80)); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(await queued(page)).toBe(0);
    const snapped = await x(page); await advance(page, 2000); expect(await x(page)).toBe(snapped);
  }
});

test('reduced motion snaps to confirmed observations without animation resources', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = await setup(page, { metadata: meta, frame: base });
  await clock(page);
  server.send(frame(0, 80)); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  const before = await x(page);
  server.send(frame(1, 80.0005)); await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue('1');
  expect(await x(page)).toBeGreaterThan(before); expect(await queued(page)).toBe(0);
});
