import { expect, test } from '@playwright/test';
import { setup, initial, metadata, vessel, settledMapView } from './fixtures';

test('metadata fits real bounds, markers point north/east, selection and play/pause work', async ({ page }) => {
  const server = await setup(page);
  const map = page.getByRole('region', { name: 'Vessel map' });
  await expect(map.getByTitle('Vessel T007')).toBeVisible();
  await expect(map.getByTitle('Vessel T012')).toBeVisible();
  const region = (await map.boundingBox())!;
  for (const id of ['T007', 'T012']) {
    const marker = (await map.getByTitle(`Vessel ${id}`).boundingBox())!;
    expect(marker.x).toBeGreaterThan(region.x);
    expect(marker.y).toBeGreaterThan(region.y);
    expect(marker.x + marker.width).toBeLessThan(region.x + region.width);
    expect(marker.y + marker.height).toBeLessThan(region.y + region.height);
  }
  await expect(map.getByTitle('Vessel T007').locator('.vessel-glyph')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(map.getByTitle('Vessel T012').locator('.vessel-glyph')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 0, 0)');
  await map.getByTitle('Vessel T012').click();
  await expect(page.locator('footer')).toContainText('T012 selected');
  await expect(map.getByTitle('Vessel T012')).toHaveClass(/is-selected/);
  await expect(map.locator('path.vessel-trail[stroke-width="4"]')).toHaveCount(1);
  await map.getByTitle('Vessel T007').focus();
  await map.getByTitle('Vessel T007').press('Enter');
  await expect(page.locator('footer')).toContainText('T007 selected');
  await map.getByTitle('Vessel T012').focus();
  await map.getByTitle('Vessel T012').press('Space');
  await expect(page.locator('footer')).toContainText('T012 selected');
  await expect(map.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeEnabled();
  expect(server.commands).toEqual([{ type: 'play' }, { type: 'pause' }]);
  expect(server.connections()).toBe(1); // StrictMode is enabled by the dev server.
  expect(server.errors).toEqual([]);
});

test('frames move markers, replace trails, preserve pan/zoom and remove missing fixes', async ({ page }) => {
  const server = await setup(page);
  const marker = page.getByTitle('Vessel T012');
  await marker.click();
  const map = page.locator('.leaflet-container');
  const mapElement = await map.elementHandle();
  const before = await marker.getAttribute('style');
  const changed = vessel('T012', 13.065, 80.325, 180);
  changed.trail_segments = [[[13.054, 80.319], [13.055, 80.32]], [[13.064, 80.324], [13.065, 80.325]]];
  server.send({ ...initial, second: 640, timestamp: '2026-11-02T03:40:40Z', vessels: [initial.vessels[0], changed] });
  await expect(marker).not.toHaveAttribute('style', before!);
  await expect(page.locator('path.vessel-trail')).toHaveCount(3);
  // Zoom/pan are real user actions; frame updates must leave their view untouched.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/);
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 50, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-pan-anim/);
  const view = await settledMapView(page);
  // Backward seek: frame is the complete replacement, without old future segments.
  server.send(initial);
  await expect(page.locator('path.vessel-trail')).toHaveCount(2);
  await expect(page.locator('time[aria-label="Current replay time"]')).toHaveText('09:00:00');
  expect(await mapElement!.evaluate(element => element === document.querySelector('.leaflet-container'))).toBe(true);
  await expect(page.locator('.leaflet-map-pane')).toHaveAttribute('style', view!);
  server.send({ ...initial, second: 600, timestamp: '2026-11-02T03:40:00Z', vessels: [initial.vessels[0]] });
  await expect(marker).toHaveCount(0);
  await expect(page.locator('footer')).toContainText('T012 selected · No current observation');
  server.send(initial);
  await expect(marker).toHaveClass(/is-selected/);
  expect(server.connections()).toBe(1);
  expect(server.errors).toEqual([]);
});

test('command errors preserve state; disconnect clears positions and reconnect starts fresh', async ({ page }) => {
  const server = await setup(page);
  server.send({ type: 'error', message: 'Replay command rejected' });
  await expect(page.getByRole('alert')).toHaveText('Replay command rejected');
  await expect(page.locator('.vessel-marker')).toHaveCount(2);
  server.close();
  await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('disconnected');
  await expect(page.locator('.vessel-marker')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('connected');
  await expect(page.locator('time[aria-label="Current replay time"]')).toHaveText('09:00:00');
  expect(server.connections()).toBe(2);
  expect(server.errors).toEqual([]);
});

test('map initialization uses supplied metadata rather than a fixed home position', async ({ page }) => {
  await setup(page, {
    metadata: { ...metadata, bounds: { south: 51.49, north: 51.52, west: -.12, east: -.08 } },
    frame: { ...initial, vessels: [vessel('ALTERNATE', 51.505, -.1)] },
  });
  const map = (await page.getByRole('region', { name: 'Vessel map' }).boundingBox())!;
  const marker = (await page.getByTitle('Vessel ALTERNATE').boundingBox())!;
  expect(marker.x).toBeGreaterThan(map.x);
  expect(marker.x + marker.width).toBeLessThan(map.x + map.width);
  expect(marker.y).toBeGreaterThan(map.y);
  expect(marker.y + marker.height).toBeLessThan(map.y + map.height);
});

test('metadata failure is visible and retry can initialize the map', async ({ page }) => {
  await setup(page, { metadataError: true });
  await expect(page.getByRole('alert')).toContainText('metadata could not be loaded');
  await expect(page.getByRole('region', { name: 'Vessel map' })).toHaveCount(0);
  await page.route('**/api/meta', route => route.fulfill({ json: metadata }));
  await page.getByRole('button', { name: 'Retry metadata' }).click();
  await expect(page.getByTitle('Vessel T007')).toBeVisible();
});

test('tile errors stay visible and a mobile viewport has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, { tileError: true });
  await expect(page.getByRole('alert')).toContainText('Some map tiles could not load');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeVisible();
});
