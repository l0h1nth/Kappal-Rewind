import { expect, test, type Page } from '@playwright/test';
import { setup, metadata, initial } from './fixtures';

const A = 'a'.repeat(32), B = 'b'.repeat(32);
const recording = (id = A, imported_at: string | null = '2026-11-07T12:00:00Z') => ({
  dataset_id: id, original_filename: 'duplicate.csv', imported_at,
  accepted_row_count: 2, vessel_count: 1, duration_seconds: 3,
  start: '2025-04-10T12:00:00Z', end: '2025-04-10T12:00:02Z',
  validation: { source_row_count: 2, discarded_row_count: 0, exact_duplicate_rows: 0,
    conflicting_duplicate_rows: 0, heading_normalizations: 1, missing_observation_seconds: 1,
    gap_count: 1, naive_timestamp_rows: 2, offset_timestamp_rows: 0, naive_timezone: 'UTC' },
});
const observation = (id: string) => ({ track_id: id, timestamp: '2025-04-10T12:00:00Z',
  lat: 13.123456, lon: 80.123456, speed_knots: 5.3, heading: 90 });
const library = (page: Page) => page.getByRole('region', { name: 'My Recordings', exact: true });
const refresh = (page: Page) => page.getByRole('button', { name: 'Refresh recordings' });
const view = (page: Page, id: string) => page.getByRole('button', { name: `View details for duplicate.csv (${id.slice(0, 8)})` });
const remove = (page: Page, id: string) => page.getByRole('button', { name: `Delete duplicate.csv (${id.slice(0, 8)})`, exact: true });
const confirmation = (page: Page) => page.getByRole('dialog', { name: 'Delete recording?' });
const recordingsTab = (page: Page) => page.getByRole('tab', { name: 'Recordings', exact: true });
const confirm = (page: Page) => confirmation(page).getByRole('button', { name: 'Delete recording', exact: true });

async function list(page: Page, records = [recording()]) {
  await page.route('**/api/datasets', route => route.fulfill({ json: records }));
  await recordingsTab(page).click(); await refresh(page).click();
  await expect(view(page, records[0].dataset_id)).toBeVisible();
}

test('library loading, empty state, API failure and refresh recovery are explicit', async ({ page }) => {
  const replay = await setup(page); await recordingsTab(page).click();
  await expect(library(page)).toContainText('No uploaded recordings yet');
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/datasets', async route => { await held; await route.fulfill({ json: [recording()] }); });
  await refresh(page).click(); await expect(library(page).getByRole('status')).toContainText('Loading recordings');
  release(); await expect(view(page, A)).toBeVisible();
  await page.route('**/api/datasets', route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
  await refresh(page).click(); await expect(library(page).getByRole('alert')).toContainText('could not be loaded');
  await page.route('**/api/datasets', route => route.fulfill({ json: [] }));
  await refresh(page).click(); await expect(library(page)).toContainText('No uploaded recordings yet');
  expect(replay.connections()).toBe(1); expect(replay.errors).toEqual([]);
});

test('duplicate filenames use stable IDs; details and bounded preview stay inside the sidebar', async ({ page }) => {
  const replay = await setup(page); await list(page, [recording(), recording(B, null)]);
  await expect(page.locator('.recording-list > li')).toHaveCount(2);
  await expect(library(page)).toContainText('Unknown (E1 import)');
  await page.route('**/api/datasets/**', route => route.fulfill({ json: route.request().url().includes('/preview')
    ? { dataset_id: A, rows: Array.from({ length: 20 }, (_, i) => observation(`SHIP-${i}`)) } : recording() }));
  await view(page, A).click();
  const details = page.getByRole('region', { name: 'Recording details', exact: true });
  await expect(details).toContainText('10 Apr 2025, 17:30:00');
  await expect(details).toContainText('Naive timestamp timezone');
  await expect(details).toContainText('13.123456');
  await expect(page.locator('.workspace-sidebar .recording-details')).toBeVisible();
  await expect(page.getByText('Upload CSV', { exact: true })).not.toBeVisible();
  await expect(view(page, B)).toHaveCount(0);
  const preview = details.getByRole('region', { name: 'Observation preview' });
  expect(await preview.evaluate(e => e.clientHeight <= 310 && e.scrollHeight > e.clientHeight && e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await preview.focus(); await expect(preview).toBeFocused();
  await page.getByRole('button', { name: 'Back to recordings' }).click();
  await expect(details).toHaveCount(0); await expect(view(page, B)).toBeVisible();
  expect(replay.connections()).toBe(1); expect(replay.errors).toEqual([]);
});

test('late details cannot overwrite a different sidebar recording', async ({ page }) => {
  const replay = await setup(page); await list(page, [recording(), recording(B)]);
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/datasets/**', async route => {
    const isA = route.request().url().includes(A); if (isA) await held;
    await route.fulfill({ json: route.request().url().includes('/preview')
      ? { dataset_id: isA ? A : B, rows: [observation(isA ? 'LATE-A' : 'CURRENT-B')] } : recording(isA ? A : B) });
  });
  await view(page, A).click(); await expect(page.getByText('Loading observation preview…')).toBeVisible();
  await page.getByRole('button', { name: 'Back to recordings' }).click(); await view(page, B).click();
  const details = page.getByRole('region', { name: 'Recording details', exact: true });
  await expect(details).toContainText('CURRENT-B'); release(); await expect(details).not.toContainText('LATE-A');
  expect(replay.connections()).toBe(1); expect(replay.errors).toEqual([]);
});

test('preview failure preserves metadata and playback', async ({ page }) => {
  const replay = await setup(page); await list(page);
  await page.route('**/api/datasets/**', route => route.request().url().includes('/preview')
    ? route.fulfill({ status: 500, json: { detail: 'Preview unavailable' } }) : route.fulfill({ json: recording() }));
  await view(page, A).click(); await expect(page.getByRole('region', { name: 'Recording details', exact: true })).toContainText('Preview could not be loaded');
  await page.getByRole('button', { name: '▶ Play', exact: true }).click(); await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  expect(replay.connections()).toBe(1); expect(replay.errors).toEqual([]);
});

test('upload refreshes the recording library while playback continues', async ({ page }) => {
  const replay = await setup(page); let stored = false;
  await page.route('**/api/datasets', route => {
    if (route.request().method() === 'POST') { stored = true; return route.fulfill({ status: 201, json: recording() }); }
    return route.fulfill({ json: stored ? [recording()] : [] });
  });
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await recordingsTab(page).click(); await page.getByText('Upload CSV', { exact: true }).click();
  await page.getByLabel('CSV file').setInputFiles({ name: 'duplicate.csv', mimeType: 'text/csv', buffer: Buffer.from('test') });
  await page.getByRole('button', { name: 'Upload and store' }).click(); await expect(view(page, A)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled(); expect(replay.connections()).toBe(1);
});

test('inactive deletion has one accessible confirmation, prevents duplicates and preserves replay', async ({ page }) => {
  const replay = await setup(page); let records = [recording(), recording(B)], requests = 0;
  await list(page, records);
  await page.route('**/api/datasets', route => route.fulfill({ json: records }));
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/datasets/${A}`, async route => {
    expect(route.request().method()).toBe('DELETE'); requests++; await held; records = [recording(B)];
    await route.fulfill({ json: { dataset_id: A, deleted: true } });
  });
  await remove(page, A).click(); await expect(confirmation(page)).toContainText('permanently');
  await expect(confirmation(page).getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(confirmation(page)).not.toBeVisible(); await expect(remove(page, A)).toBeFocused(); expect(requests).toBe(0);
  await remove(page, A).click(); await confirm(page).click();
  await expect(confirmation(page).getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(confirmation(page)).toBeVisible(); expect(requests).toBe(1);
  release(); await expect(remove(page, A)).toHaveCount(0); await expect(remove(page, B)).toBeVisible();
  await expect(library(page).getByRole('status')).toContainText('Deleted duplicate.csv'); expect(replay.connections()).toBe(1);
});

for (const singleSecond of [false, true]) {
  test(`one confirmation deletes loaded ${singleSecond ? 'single-second' : 'playing'} recording into an empty workspace`, async ({ page }) => {
    const replay = await setup(page); let removed = false, deletes = 0, closed = false;
    await list(page); await page.route('**/api/datasets', route => route.fulfill({ json: removed ? [] : [recording()] }));
    await page.route(`**/api/datasets/${A}`, route => route.request().method() === 'DELETE'
      ? (() => { expect(closed).toBe(true); deletes++; removed = true; return route.fulfill({ json: { dataset_id: A, deleted: true } }); })()
      : route.fulfill({ json: recording() }));
    await page.route(`**/api/replay/${A}/meta`, route => route.fulfill({ json: { ...metadata, dataset_id: A, ...(singleSecond ? { end: metadata.start, recording_seconds: 1 } : {}) } }));
    await page.routeWebSocket(`**/ws/replay?dataset_id=${A}`, route => {
      const state = { ...initial, dataset_id: A, duration_seconds: singleSecond ? 1 : 1800 };
      route.send(JSON.stringify(state)); route.onMessage(() => route.send(JSON.stringify({ ...state, playing: true })));
      route.onClose(() => { closed = true; route.close(); });
    });
    await page.getByRole('button', { name: `Replay duplicate.csv (${A.slice(0, 8)})`, exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Vessels', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Current recording')).toContainText(A);
    const map = await page.locator('.leaflet-container').elementHandle();
    if (!singleSecond) await page.getByRole('button', { name: '▶ Play', exact: true }).click();
    await recordingsTab(page).click(); await expect(page.locator('.current-badge')).toHaveText('Current');
    await remove(page, A).click(); await confirm(page).click();
    await expect(confirmation(page)).not.toBeVisible(); expect(deletes).toBe(1);
    await expect(page.getByLabel('Current recording')).toContainText('No recording loaded');
    await expect(page.locator('.vessel-marker, path.vessel-trail')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: 'Replay position' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeDisabled();
    expect(replay.connections()).toBe(1);
    expect(await map!.evaluate(e => e === document.querySelector('.leaflet-container'))).toBe(true);
    await page.getByRole('button', { name: 'Replay built-in assignment' }).click();
    await expect(page.getByLabel('Current recording')).toContainText('Built-in assignment');
    await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeEnabled(); expect(replay.connections()).toBe(2);
    expect(replay.errors).toEqual([]);
  });
}

test('409 on current deletion preserves empty state and allows safe retry without builtin reconnect', async ({ page }) => {
  const replay = await setup(page); await list(page);
  await page.route(`**/api/replay/${A}/meta`, route => route.fulfill({ json: { ...metadata, dataset_id: A } }));
  await page.routeWebSocket(`**/ws/replay?dataset_id=${A}`, route => route.send(JSON.stringify({ ...initial, dataset_id: A })));
  await page.getByRole('button', { name: `Replay duplicate.csv (${A.slice(0, 8)})`, exact: true }).click();
  await expect(page.getByLabel('Current recording')).toContainText(A); await recordingsTab(page).click();
  let requests = 0;
  await page.route(`**/api/datasets/${A}`, route => route.request().method() === 'DELETE'
    ? (() => { requests++; return route.fulfill({ status: 409, json: { detail: 'Recording currently being replayed.' } }); })()
    : route.fulfill({ json: recording() }));
  await remove(page, A).click(); await confirm(page).click();
  await expect(confirmation(page).getByRole('alert')).toContainText('Another tab');
  await expect(page.getByLabel('Current recording')).toContainText('No recording loaded');
  expect(replay.connections()).toBe(1); expect(requests).toBe(1);
  await page.route(`**/api/datasets/${A}`, route => route.fulfill({ json: { dataset_id: A, deleted: true } }));
  await confirm(page).click(); await expect(confirmation(page)).not.toBeVisible(); expect(replay.connections()).toBe(1);
});

for (const partial of [false, true]) {
  test(`storage failure ${partial ? 'after' : 'before'} rename reports actual error`, async ({ page }) => {
    await setup(page); await list(page, [recording(), recording(B)]);
    let failed = false;
    await page.route('**/api/datasets', route => route.fulfill({ json: failed && partial ? [recording(B)] : [recording(), recording(B)] }));
    await page.route(`**/api/datasets/${A}`, route => { failed = true; return route.fulfill({ status: 500, json: { detail: partial ? 'Removed from library; administrator must finish cleanup.' : 'Could not delete; stored files were not removed.', removed_from_library: partial } }); });
    await remove(page, A).click(); await confirm(page).click();
    await expect(partial ? library(page).getByRole('alert') : confirmation(page).getByRole('alert')).toContainText(partial ? 'administrator' : 'not removed');
    if (partial) await expect(remove(page, A)).toHaveCount(0);
    else { await expect(confirm(page)).toBeEnabled(); await confirmation(page).getByRole('button', { name: 'Cancel', exact: true }).click(); }
    await expect(remove(page, B)).toBeVisible();
  });
}
