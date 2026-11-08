import { expect, test } from '@playwright/test';
import { setup, initial, metadata, vessel, settledMapView } from './fixtures';

for (const speed of [0, 1, 5, 10]) {
  test(`first pointer click survives heading updates (${speed || 'paused'}×)`, async ({ page }) => {
    const frame = { ...initial, playing: speed > 0, speed: speed || 1 };
    const server = await setup(page, { frame: { ...frame, playing: false } });
    if (speed) {
      await page.getByLabel('Playback speed').selectOption(String(speed));
      await page.getByRole('button', { name: '▶ Play', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
    }
    const commandsBefore = [...server.commands];
    const marker = page.getByTitle('Vessel T007');
    await marker.scrollIntoViewIfNeeded();
    const oldMarker = await marker.elementHandle();
    const box = (await marker.locator('path').boundingBox())!;
    // Painted hull, not an empty corner; no locator.click retries or event dispatch.
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    server.send({ ...frame, second: 1,
      vessels: [vessel('T007', 13.082801, 80.358893, 90), initial.vessels[1]] });
    await expect(marker.locator('.vessel-glyph')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
    await page.mouse.up();
    await expect(page.getByRole('complementary', { name: 'Vessel details' }).getByRole('heading', { level: 2 })).toHaveText('T007');
    await expect(marker).toHaveClass(/is-selected/);
    expect(await oldMarker!.evaluate(e => e === document.querySelector('[title="Vessel T007"]'))).toBe(true);
    server.send({ ...frame, second: 2, vessels: [vessel('T007', 13.0829, 80.359, 180), initial.vessels[1]] });
    await expect(marker.locator('.vessel-glyph')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
    await expect(marker).toHaveClass(/is-selected/);
    expect(server.commands).toEqual(commandsBefore); // Selection requires no server acknowledgement.
    expect(server.errors).toEqual([]);
  });
}

test('nearby markers, trails, zoom, pan and selection after seeks/gaps stay usable', async ({ page }) => {
  const vessels = [vessel('NEAR-A', 13.07, 80.335), vessel('NEAR-B', 13.07, 80.3356)];
  const server = await setup(page, { frame: { ...initial, vessels } });
  const a = page.getByTitle('Vessel NEAR-A'), b = page.getByTitle('Vessel NEAR-B');
  await a.scrollIntoViewIfNeeded();
  // At the narrower map's fitted zoom the exposed edge is only one pixel;
  // zoom once so a real integer-coordinate pointer can reach it reliably.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await settledMapView(page);
  const ab = (await a.boundingBox())!, bb = (await b.boundingBox())!;
  expect(Math.abs(ab.x - bb.x)).toBeLessThan(32); // Overlapping targets at initial zoom.
  // The visible uncovered edge selects A; selection raises it above the other marker.
  const exposedWidth = bb.x - ab.x;
  expect(exposedWidth).toBeGreaterThan(0);
  const point = { x: Math.ceil(ab.x) + 1, y: Math.round(ab.y + 16) };
  expect(point.x).toBeLessThan(bb.x);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.vessel-marker')?.getAttribute('title'), point)).toBe('Vessel NEAR-A');
  await page.mouse.click(point.x, point.y);
  await expect(a).toHaveClass(/is-selected/);
  await page.getByRole('button', { name: 'Zoom in' }).click({ clickCount: 3, delay: 350 });
  await settledMapView(page);
  for (const marker of [b, a]) {
    const box = (await marker.boundingBox())!;
    const title = await marker.getAttribute('title');
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.vessel-marker')?.getAttribute('title'),
      { x: box.x + 16, y: box.y + 16 })).toBe(title);
    await page.mouse.click(box.x + 16, box.y + 16);
    await expect(marker).toHaveClass(/is-selected/);
  }
  await expect(page.locator('path.vessel-trail.leaflet-interactive')).toHaveCount(0);
  const slider = page.getByRole('slider', { name: 'Replay position' });
  for (const key of ['End', 'Home', 'ArrowRight', 'Home']) {
    await slider.focus(); await slider.press(key);
    await expect(slider).toBeEnabled();
  }
  await b.click();
  await expect(page.getByRole('complementary', { name: 'Vessel details' }).getByRole('heading', { level: 2 })).toHaveText('NEAR-B');
  server.send({ ...initial, second: 50, vessels: [vessels[0]] });
  await expect(page.getByText('No observation at this time.', { exact: true })).toBeVisible();
  server.send({ ...initial, vessels });
  await expect(b).toHaveClass(/is-selected/);
  const map = page.locator('.leaflet-container');
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  const before = await settledMapView(page);
  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 150, { steps: 8 }); await page.mouse.up();
  expect(await settledMapView(page)).not.toBe(before);
  expect(server.errors).toEqual([]);
});

test('100-vessel 10× frames retain marker identities and first-click selection', async ({ page }) => {
  const vessels = Array.from({ length: 100 }, (_, i) => vessel(`L${i}`, 13.04 + Math.floor(i / 10) * .006, 80.305 + (i % 10) * .006));
  const frame = { ...initial, playing: true, speed: 10, vessels };
  const server = await setup(page, { metadata: { ...metadata, vessel_count: 100, vessel_ids: vessels.map(v => v.id) }, frame: { ...frame, playing: false } });
  await page.getByLabel('Playback speed').selectOption('10');
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await expect(page.locator('.vessel-marker')).toHaveCount(100);
  const originals = new Map(await Promise.all(['L55', 'L54'].map(async id =>
    [id, await page.getByTitle(`Vessel ${id}`, { exact: true }).elementHandle()] as const)));
  await page.locator('.leaflet-container').scrollIntoViewIfNeeded();
  for (let second = 1; second <= 10; second++) {
    const id = second % 2 ? 'L55' : 'L54';
    const marker = page.getByTitle(`Vessel ${id}`, { exact: true });
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + 16, box.y + 16); await page.mouse.down();
    server.send({ ...frame, second, vessels: vessels.map(v => ({ ...v, heading: second * 10 })) });
    await expect(marker.locator('.vessel-glyph')).toHaveAttribute('style', new RegExp(`rotate\\(${second * 10}deg\\)`));
    await page.mouse.up();
    await expect(marker).toHaveClass(/is-selected/);
    await expect(page.getByRole('complementary', { name: 'Vessel details' }).getByRole('heading', { level: 2 })).toHaveText(id);
    expect(await originals.get(id)!.evaluate(e => e === document.querySelector(`[title="${e.getAttribute('title')}"]`))).toBe(true);
  }
  expect(server.errors).toEqual([]);
});
