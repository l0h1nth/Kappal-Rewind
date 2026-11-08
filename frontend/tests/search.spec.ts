import { expect, test } from '@playwright/test';
import { setup, initial, metadata, vessel, settledMapView } from './fixtures';

test('search is visible by default, filters case-insensitively and supports keyboard selection', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  const server = await setup(page);
  const search = page.getByLabel('Search vessel ID');
  await expect(search).toBeVisible();
  await expect(page.getByRole('list', { name: 'Matching vessels' }).getByRole('button')).toHaveCount(20);
  const before = requests.length;
  await search.fill(' t007 ');
  const result = page.getByRole('list', { name: 'Matching vessels' }).getByRole('button');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('T007');
  await expect(result).toContainText('Current observation');
  await search.press('Tab');
  await expect(result).toBeFocused();
  await result.press('Enter');
  await expect(page.locator('.vessel-panel h2')).toHaveText('T007');
  await expect(result).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTitle('Vessel T007')).toHaveClass(/is-selected/);
  expect(requests.length).toBe(before);
  expect(server.commands).toEqual([]);
});

test('one search click focuses a current fix once; subsequent playback preserves user navigation', async ({ page }) => {
  const server = await setup(page);
  const map = page.locator('.leaflet-container');
  const mapElement = await map.elementHandle();
  await page.getByLabel('Search vessel ID').fill('t007');
  await page.getByRole('list', { name: 'Matching vessels' }).getByRole('button').click();
  const marker = page.getByTitle('Vessel T007');
  await expect(marker).toHaveClass(/is-selected/);
  await expect(page.locator('.vessel-panel h2')).toHaveText('T007');
  await expect.poll(async () => {
    const target = (await marker.boundingBox())!;
    const box = (await map.boundingBox())!;
    return Math.max(Math.abs(target.x + target.width / 2 - box.x - box.width / 2),
      Math.abs(target.y + target.height / 2 - box.y - box.height / 2));
  }).toBeLessThan(3);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 150, { steps: 8 }); await page.mouse.up();
  const view = await settledMapView(page);
  server.send({ ...initial, second: 1, timestamp: '2026-11-02T03:30:01Z', playing: true,
    vessels: [vessel('T007', 13.083, 80.36), initial.vessels[1]] });
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue('1');
  await expect(page.locator('.leaflet-map-pane')).toHaveAttribute('style', view);
  await expect(marker).toHaveClass(/is-selected/);
  expect(await mapElement!.evaluate(e => e === document.querySelector('.leaflet-container'))).toBe(true);
  expect(server.commands).toEqual([]);
  expect(server.errors).toEqual([]);
});

test('500-vessel search stays bounded and keyboard-accessible on a small screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const ids = Array.from({ length: 500 }, (_, index) => `SHIP${String(index).padStart(3, '0')}`);
  await setup(page, { metadata: { ...metadata, vessel_count: ids.length, vessel_ids: ids },
    frame: { ...initial, vessels: [vessel(ids[499], 13.08, 80.35)] } });
  const search = page.getByLabel('Search vessel ID');
  await search.scrollIntoViewIfNeeded();
  await expect(search).toBeVisible();
  const results = page.getByRole('list', { name: 'Matching vessels' });
  await expect(results.getByRole('button')).toHaveCount(500);
  expect(await results.evaluate(e => e.clientHeight <= 180 && e.scrollHeight > e.clientHeight)).toBe(true);
  await search.fill('ship499');
  await search.press('Tab'); await page.keyboard.press('Space');
  await expect(page.locator('.vessel-panel h2')).toHaveText('SHIP499');
  await expect(page.getByTitle('Vessel SHIP499')).toHaveClass(/is-selected/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
