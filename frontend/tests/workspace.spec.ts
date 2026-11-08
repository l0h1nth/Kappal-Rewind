import { expect, test } from '@playwright/test';
import { setup, initial, metadata } from './fixtures';

for (const width of [1440, 900, 768, 390]) {
  test(`workspace fits ${width}px with usable map, timeline and tab navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const server = await setup(page);
    const map = await page.locator('.leaflet-container').elementHandle();
    const bounds = (await page.locator('.leaflet-container').boundingBox())!;
    expect(bounds.height).toBeGreaterThan(300); expect(bounds.width).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width > 800) {
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
      const sidebar = (await page.locator('.workspace-sidebar').boundingBox())!;
      expect(sidebar.width).toBeGreaterThanOrEqual(300); expect(sidebar.width).toBeLessThanOrEqual(340);
      expect(Math.abs(sidebar.y - bounds.y)).toBeLessThan(2);
      const timeline = (await page.getByRole('region', { name: 'Playback controls' }).boundingBox())!;
      expect(timeline.y).toBeGreaterThan(bounds.y + bounds.height); expect(timeline.y + timeline.height).toBeLessThanOrEqual(900);
    }
    const vessels = page.getByRole('tab', { name: 'Vessels', exact: true });
    await vessels.focus(); await vessels.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Recordings', exact: true })).toBeFocused();
    await expect(page.getByRole('region', { name: 'My Recordings' })).toBeVisible();
    await page.getByRole('tab', { name: 'Recordings', exact: true }).press('Home');
    await expect(vessels).toBeFocused(); await expect(page.getByRole('combobox', { name: 'Search vessel ID' })).toBeVisible();
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
