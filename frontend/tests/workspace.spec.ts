import { expect, test } from '@playwright/test';
import { setup, initial, metadata, settledMapView } from './fixtures';

for (const [width, height] of [[1440, 900], [1280, 800], [768, 1024], [390, 844]]) {
  test(`Coastal views fit ${width}×${height} with readable controls and persistent map`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const server = await setup(page);
    await page.evaluate(() => document.fonts.ready);
    const map = await page.locator('.leaflet-container').elementHandle();
    const bounds = (await page.locator('.leaflet-container').boundingBox())!;
    expect(bounds.height).toBeGreaterThan(300); expect(bounds.width).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('body').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await page.locator('main').evaluate(e => getComputedStyle(e).backgroundColor)).not.toBe('rgb(12, 36, 43)');
    if (width > 1100) {
      const column = (await page.locator('.workspace-sidebar').boundingBox())!;
      expect(column.width).toBeGreaterThan(340);
      const workspace = (await page.locator('.workspace').boundingBox())!;
      expect(bounds.width / workspace.width).toBeGreaterThan(.60);
      expect(bounds.width / workspace.width).toBeLessThan(.70);
      const timeline = (await page.getByRole('region', { name: 'Playback controls' }).boundingBox())!;
      expect(Math.abs(timeline.width - (await page.locator('.map-card').boundingBox())!.width)).toBeLessThan(2);
      expect(timeline.y).toBeGreaterThan(bounds.y + bounds.height);
    }
    const replay = page.getByRole('tab', { name: 'Replay', exact: true });
    await replay.focus(); await replay.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Recordings', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'My Recordings' })).toBeVisible();
    await expect(page.locator('.leaflet-container')).not.toBeVisible();
    await page.getByRole('tab', { name: 'Recordings', exact: true }).press('Home');
    await expect(replay).toBeFocused(); await expect(page.getByRole('combobox', { name: 'Search vessel ID' })).toBeVisible();
    expect(await map!.evaluate(e => e === document.querySelector('.leaflet-container'))).toBe(true);
    expect(server.connections()).toBe(1); expect(server.errors).toEqual([]);
  });
}

test('autocomplete arrows, escape, outside click and empty matches retain selection and focus', async ({ page }) => {
  await setup(page);
  const input = page.getByRole('combobox', { name: 'Search vessel ID' });
  await input.fill('t00'); await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(8);
  await input.press('ArrowUp'); await expect(input).toHaveAttribute('aria-activedescendant', 'vessel-option-7');
  await expect.poll(async () => {
    const option = (await page.locator('#vessel-option-7').boundingBox())!;
    const list = (await page.getByRole('listbox').boundingBox())!;
    return option.y >= list.y - 1 && option.y + option.height <= list.y + list.height + 1;
  }).toBe(true);
  await input.press('ArrowDown'); await expect(input).toHaveAttribute('aria-activedescendant', 'vessel-option-0');
  await input.press('Escape'); await expect(input).toHaveAttribute('aria-expanded', 'false'); await expect(input).toBeFocused();
  await input.fill('t007'); await input.press('ArrowDown'); await input.press('Enter');
  await expect(page.locator('.vessel-panel h2')).toHaveText('T007');
  await input.fill('not-a-vessel'); await expect(page.getByText('No matching vessels.', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Kappal Rewind' }).click(); await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.vessel-panel h2')).toHaveText('T007');
});

test('library bounds rendered rows, filters by stable ID and uses equal action targets', async ({ page }) => {
  await setup(page);
  const entries = Array.from({ length: 120 }, (_, i) => ({ dataset_id: i.toString(16).padStart(32, '0'), original_filename: `recording-${i}.csv`, imported_at: null,
    vessel_count: 1, accepted_row_count: 1, duration_seconds: 1, start: metadata.start, end: metadata.start,
    validation: { naive_timezone: 'UTC', source_row_count: 1, discarded_row_count: 0, exact_duplicate_rows: 0, conflicting_duplicate_rows: 0, heading_normalizations: 0, missing_observation_seconds: 0, gap_count: 0, naive_timestamp_rows: 0, offset_timestamp_rows: 1 } }));
  await page.route('**/api/datasets', route => route.fulfill({ json: entries }));
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click(); await page.getByRole('button', { name: 'Refresh recordings' }).click();
  await expect(page.locator('.recording-list > li')).toHaveCount(50);
  await page.getByRole('searchbox', { name: 'Search recordings' }).fill(entries[119].dataset_id);
  await expect(page.locator('.recording-list > li')).toHaveCount(1); await expect(page.locator('.recording-list')).toContainText('recording-119.csv');
  const boxes = await page.locator('.recording-actions button').evaluateAll(elements => elements.map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })));
  expect(boxes).toHaveLength(3); for (const box of boxes) { expect(box.height).toBeGreaterThanOrEqual(40); expect(Math.abs(box.width - boxes[0].width)).toBeLessThan(1); }
});

test('deletion waits for local close and immediately clears markers, trails and queued replay callbacks', async ({ page }) => {
  const id = 'c'.repeat(32); await setup(page);
  const record = { dataset_id: id, original_filename: 'close.csv', imported_at: null,
    vessel_count: 20, accepted_row_count: 35780, duration_seconds: 1800, start: metadata.start, end: metadata.end,
    validation: { naive_timezone: 'UTC', source_row_count: 35780, discarded_row_count: 0, exact_duplicate_rows: 0, conflicting_duplicate_rows: 0, heading_normalizations: 0, missing_observation_seconds: 220, gap_count: 2, naive_timestamp_rows: 0, offset_timestamp_rows: 35780 } };
  await page.route('**/api/datasets', route => route.fulfill({ json: [record] }));
  await page.route(`**/api/datasets/${id}`, route => route.fulfill({ json: record }));
  await page.route(`**/api/replay/${id}/meta`, route => route.fulfill({ json: { ...metadata, dataset_id: id } }));
  await page.routeWebSocket(`**/ws/replay?dataset_id=${id}`, route => route.send(JSON.stringify({ ...initial, dataset_id: id })));
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click(); await page.getByRole('button', { name: 'Refresh recordings' }).click();
  await page.getByRole('button', { name: `Replay close.csv (${id.slice(0, 8)})` }).click();
  await expect(page.getByTitle('Vessel T007')).toBeVisible();
  // Delay native close only in this controlled fixture; the production code must await its event.
  await page.evaluate(() => {
    const original = WebSocket.prototype.close;
    WebSocket.prototype.close = function () {
      const socket = this;
      Object.assign(window, { oldMessage: socket.onmessage?.bind(socket), releaseClose: () => { WebSocket.prototype.close = original; original.call(socket); } });
    };
  });
  let deletes = 0;
  await page.route(`**/api/datasets/${id}`, route => { if (route.request().method() !== 'DELETE') return route.fulfill({ json: record }); deletes++; return route.fulfill({ json: { dataset_id: id, deleted: true } }); });
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click(); await page.getByRole('button', { name: `Delete close.csv (${id.slice(0, 8)})` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete recording', exact: true }).click();
  await expect(page.getByLabel('Current recording')).toContainText('No recording loaded');
  await expect(page.locator('.vessel-marker, path.vessel-trail')).toHaveCount(0); expect(deletes).toBe(0);
  await page.evaluate(frame => {
    const w = window as unknown as { oldMessage?: (event: MessageEvent) => void; releaseClose: () => void };
    w.oldMessage?.(new MessageEvent('message', { data: JSON.stringify(frame) })); w.releaseClose();
  }, { ...initial, dataset_id: id });
  await expect(page.getByRole('dialog')).not.toBeVisible(); expect(deletes).toBe(1);
  await expect(page.locator('.vessel-marker')).toHaveCount(0);
});


test('initial map metadata arriving in Recordings fits only after Replay becomes visible', async ({ page }) => {
  const server = await setup(page, { metadataError: true });
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/meta', async route => { await held; await route.fulfill({ json: metadata }); });
  await page.getByRole('button', { name: 'Retry metadata' }).click();
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click(); release();
  await expect(page.locator('.leaflet-container')).toHaveCount(1);
  await expect(page.locator('.leaflet-container')).not.toBeVisible();
  await page.getByRole('tab', { name: 'Replay', exact: true }).click();
  await expect.poll(async () => {
    const map = (await page.locator('.leaflet-container').boundingBox())!;
    const boat = (await page.getByTitle('Vessel T007').boundingBox())!;
    return boat.x > map.x && boat.x + boat.width < map.x + map.width && boat.y > map.y && boat.y + boat.height < map.y + map.height;
  }).toBe(true);
  expect(server.errors).toEqual([]);
});

test('switching views preserves the selected vessel and user pan/zoom without reconnecting', async ({ page }) => {
  const server = await setup(page);
  await page.getByTitle('Vessel T007').click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  await page.mouse.move(box.x + 90, box.y + 90); await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 130, { steps: 8 }); await page.mouse.up();
  await settledMapView(page);
  const before = (await page.getByTitle('Vessel T007').boundingBox())!;
  await page.getByRole('tab', { name: 'Recordings', exact: true }).click();
  await page.getByRole('tab', { name: 'Replay', exact: true }).click();
  await expect.poll(async () => {
    const after = (await page.getByTitle('Vessel T007').boundingBox())!;
    return Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
  }).toBeLessThan(2);
  await expect(page.getByTitle('Vessel T007')).toHaveClass(/is-selected/);
  expect(server.connections()).toBe(1); expect(server.errors).toEqual([]);
});
