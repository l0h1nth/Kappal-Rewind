import { expect, test, type Page } from '@playwright/test';
import { setup } from './fixtures';

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

async function list(page: Page, records = [recording()]) {
  await page.route('**/api/datasets', route => route.fulfill({ json: records }));
  await refresh(page).click();
  await expect(view(page, records[0].dataset_id)).toBeVisible();
}

test('library loading, empty state, API failure and refresh recovery are explicit', async ({ page }) => {
  const replay = await setup(page);
  await expect(library(page)).toContainText('No uploaded recordings yet');
  let release: () => void = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/datasets', async route => { await wait; await route.fulfill({ json: [recording()] }); });
  await refresh(page).click();
  await expect(library(page).getByRole('status')).toContainText('Loading recordings');
  release();
  await expect(view(page, A)).toBeVisible();
  await page.route('**/api/datasets', route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
  await refresh(page).click();
  await expect(library(page).getByRole('alert')).toContainText('could not be loaded');
  await expect(view(page, A)).toHaveCount(0);
  await page.route('**/api/datasets', route => route.fulfill({ json: [] }));
  await refresh(page).click();
  await expect(library(page)).toContainText('No uploaded recordings yet');
  expect(replay.connections()).toBe(1);
  expect(replay.errors).toEqual([]);
});

test('duplicate filenames retain distinct IDs; details and bounded preview show IST and scroll on mobile', async ({ page }) => {
  const replay = await setup(page);
  await list(page, [recording(), recording(B, null)]);
  await expect(library(page).getByRole('listitem')).toHaveCount(2);
  await expect(library(page)).toContainText('Unknown (E1 import)');
  await page.route('**/api/datasets/**', route => {
    if (route.request().url().includes('/preview')) {
      expect(new URL(route.request().url()).searchParams.get('limit')).toBe('20');
      return route.fulfill({ json: { dataset_id: A, rows: [observation('SHIP-A')] } });
    }
    return route.fulfill({ json: recording() });
  });
  await view(page, A).click();
  const details = page.getByRole('region', { name: 'Recording details', exact: true });
  await expect(details).toContainText('Read-only recording details');
  await expect(details).toContainText('10 Apr 2025, 17:30:00');
  await expect(details).toContainText('Naive timestamp timezone');
  const table = details.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText('SHIP-A');
  await expect(table).toContainText('13.123456');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroll = details.getByRole('region', { name: 'Observation preview' });
  expect(await scroll.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await scroll.focus();
  await expect(scroll).toBeFocused();
  await page.getByRole('button', { name: 'Close recording details' }).click();
  await expect(details).toHaveCount(0);
  expect(replay.connections()).toBe(1);
  expect(replay.errors).toEqual([]);
});

test('late detail and preview responses cannot overwrite a newly opened recording', async ({ page }) => {
  const replay = await setup(page);
  await list(page, [recording(), recording(B)]);
  let release: () => void = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/datasets/**', async route => {
    const isA = route.request().url().includes(A);
    if (isA) await wait;
    await route.fulfill({ json: route.request().url().includes('/preview')
      ? { dataset_id: isA ? A : B, rows: [observation(isA ? 'LATE-A' : 'CURRENT-B')] }
      : recording(isA ? A : B) });
  });
  await view(page, A).click();
  await expect(page.getByText('Loading observation preview…')).toBeVisible();
  await view(page, B).click();
  const details = page.getByRole('region', { name: 'Recording details', exact: true });
  await expect(details).toContainText('CURRENT-B');
  release();
  await expect(details).not.toContainText('LATE-A');
  await expect(details).toContainText(B);
  expect(replay.connections()).toBe(1);
  expect(replay.errors).toEqual([]);
});

test('preview failure leaves metadata and playback available', async ({ page }) => {
  const replay = await setup(page);
  await list(page);
  await page.route('**/api/datasets/**', route => route.request().url().includes('/preview')
    ? route.fulfill({ status: 500, json: { detail: 'Preview unavailable' } })
    : route.fulfill({ json: recording() }));
  await view(page, A).click();
  const details = page.getByRole('region', { name: 'Recording details', exact: true });
  await expect(details).toContainText('duplicate.csv');
  await expect(details.getByRole('alert')).toContainText('Preview could not be loaded');
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  expect(replay.connections()).toBe(1);
  expect(replay.errors).toEqual([]);
});

test('successful upload automatically refreshes library without resetting replay or reloading', async ({ page }) => {
  const replay = await setup(page);
  let stored = false;
  await page.route('**/api/datasets', route => {
    if (route.request().method() === 'POST') { stored = true; return route.fulfill({ status: 201, json: recording() }); }
    return route.fulfill({ json: stored ? [recording()] : [] });
  });
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await page.getByText('Upload CSV', { exact: true }).click();
  await page.getByLabel('CSV file').setInputFiles({ name: 'duplicate.csv', mimeType: 'text/csv', buffer: Buffer.from('test') });
  await page.getByRole('button', { name: 'Upload and store' }).click();
  await expect(view(page, A)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  expect(replay.connections()).toBe(1);
  expect(replay.errors).toEqual([]);
});

const remove = (page: Page, id: string) => page.getByRole('button', { name: `Delete duplicate.csv (${id.slice(0, 8)})`, exact: true });
const confirmation = (page: Page) => page.getByRole('alertdialog', { name: 'Delete recording?' });

test('delete requires named permanent confirmation, prevents duplicate submits and preserves another preview/replay', async ({ page }) => {
  const server = await setup(page);
  let records = [recording(), recording(B)], requests = 0;
  await page.route('**/api/datasets', route => route.fulfill({ json: records }));
  await refresh(page).click();
  await page.route(`**/api/datasets/${B}`, route => route.fulfill({ json: recording(B) }));
  await page.route(`**/api/datasets/${B}/preview?limit=20`, route => route.fulfill({ json: { dataset_id: B, rows: [observation('KEEP-B')] } }));
  await view(page, B).click();
  await expect(page.getByRole('table')).toContainText('KEEP-B');
  const table = await page.getByRole('table').elementHandle();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/datasets/${A}`, async route => {
    expect(route.request().method()).toBe('DELETE'); requests++;
    await held; records = [recording(B)];
    await route.fulfill({ json: { dataset_id: A, deleted: true } });
  });
  await remove(page, A).click();
  await expect(confirmation(page)).toContainText('duplicate.csv');
  await expect(confirmation(page)).toContainText('Permanently');
  await expect(confirmation(page)).toContainText('cannot be undone');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(requests).toBe(0);
  await remove(page, A).click();
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).dblclick();
  await expect(page.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await expect(remove(page, B)).toBeDisabled(); expect(requests).toBe(1);
  release();
  await expect(remove(page, A)).toHaveCount(0); await expect(remove(page, B)).toBeVisible();
  await expect(library(page).getByRole('status')).toContainText('Deleted duplicate.csv');
  await expect(page.getByRole('table')).toContainText('KEEP-B');
  expect(await table!.evaluate(el => el === document.querySelector('table'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  expect(server.connections()).toBe(1); expect(server.errors).toEqual([]);
});

for (const singleSecond of [false, true]) {
  test(`loaded ${singleSecond ? 'finished single-second' : 'playing'} recording must explicitly switch to builtin before deletion`, async ({ page }) => {
    const server = await setup(page);
    const { metadata, initial } = await import('./fixtures');
    let removed = false, deletes = 0;
    await page.route('**/api/datasets', route => route.fulfill({ json: removed ? [] : [recording()] }));
    await refresh(page).click();
    await page.route(`**/api/replay/${A}/meta`, route => route.fulfill({ json: { ...metadata, dataset_id: A,
      ...(singleSecond ? { end: metadata.start, recording_seconds: 1 } : {}) } }));
    await page.routeWebSocket(`**/ws/replay?dataset_id=${A}`, route => {
      const state = { ...initial, dataset_id: A, duration_seconds: singleSecond ? 1 : 1800 };
      route.send(JSON.stringify(state));
      route.onMessage(() => route.send(JSON.stringify({ ...state, playing: true })));
    });
    await page.getByRole('button', { name: `Replay duplicate.csv (${A.slice(0, 8)})`, exact: true }).click();
    await expect(page.getByLabel('Current recording')).toContainText(A);
    if (!singleSecond) await page.getByRole('button', { name: '▶ Play', exact: true }).click();
    await page.route(`**/api/datasets/${A}`, route => {
      if (route.request().method() !== 'DELETE') return route.fulfill({ json: recording() });
      deletes++; removed = true; return route.fulfill({ json: { dataset_id: A, deleted: true } });
    });
    await remove(page, A).click();
    await expect(confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true })).toBeDisabled();
    expect(deletes).toBe(0);
    let sendBuiltin = () => {};
    await page.routeWebSocket('**/ws/replay', route => { sendBuiltin = () => route.send(JSON.stringify(initial)); });
    // Slow preflight must keep Delete disabled and the original replay intact.
    let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/meta', async route => { await held; await route.fulfill({ json: metadata }); });
    await confirmation(page).getByRole('button', { name: 'Switch to built-in assignment' }).click();
    await expect(confirmation(page)).toContainText('Switching');
    await expect(page.getByLabel('Current recording')).toContainText(A);
    await expect(confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true })).toBeDisabled();
    release();
    await expect(page.getByLabel('Current recording')).toContainText('Built-in assignment');
    await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('connected');
    await expect(confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true })).toBeDisabled();
    sendBuiltin();
    await expect(confirmation(page)).toContainText('Built-in assignment loaded');
    await expect(confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true })).toBeEnabled();
    await confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true }).click();
    await expect(remove(page, A)).toHaveCount(0);
    expect(deletes).toBe(1); expect(server.errors).toEqual([]);
  });
}

test('another tab conflict remains visible and does not silently switch unrelated playback', async ({ page }) => {
  const server = await setup(page); await list(page);
  let deletes = 0;
  await page.route(`**/api/datasets/${A}`, route => { if (route.request().method() !== 'DELETE') return route.fulfill({ json: recording() }); deletes++; return route.fulfill({ status: 409, json: { detail: 'busy' } }); });
  await remove(page, A).click();
  await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
  await expect(library(page).getByRole('alert')).toContainText('another tab');
  await expect(page.getByLabel('Current recording')).toContainText('Built-in assignment');
  await expect(remove(page, A)).toBeVisible();
  expect(deletes).toBe(1); expect(server.connections()).toBe(1);
});

for (const partial of [false, true]) {
  test(`storage failure ${partial ? 'after' : 'before'} rename has an explicit recoverable UI state`, async ({ page }) => {
    const server = await setup(page);
    let failed = false;
    await page.route('**/api/datasets', route => route.fulfill({ json: failed && partial ? [recording(B)] : [recording(), recording(B)] }));
    await refresh(page).click();
    await page.route(`**/api/datasets/${A}`, route => {
      failed = true;
      return route.fulfill({ status: 500, json: { detail: partial ? 'Removed from library; administrator must finish cleanup.' : 'Could not delete; stored files were not removed.', removed_from_library: partial } });
    });
    await remove(page, A).click(); await page.getByRole('button', { name: 'Permanently delete', exact: true }).click();
    await expect(library(page).getByRole('alert')).toContainText(partial ? 'administrator' : 'not removed');
    if (partial) {
      await expect(remove(page, A)).toHaveCount(0); await expect(confirmation(page)).toHaveCount(0);
    } else {
      await expect(remove(page, A)).toBeEnabled(); await expect(confirmation(page)).toBeVisible();
    }
    await expect(remove(page, B)).toBeVisible();
    expect(server.connections()).toBe(1); expect(server.errors).toEqual([]);
  });
}


test('failed builtin switch can retry metadata and reconnect locally without sending deletion early', async ({ page }) => {
  const server = await setup(page);
  const { metadata, initial } = await import('./fixtures');
  await list(page);
  await page.route(`**/api/replay/${A}/meta`, route => route.fulfill({ json: { ...metadata, dataset_id: A } }));
  await page.routeWebSocket(`**/ws/replay?dataset_id=${A}`, route => route.send(JSON.stringify({ ...initial, dataset_id: A })));
  await page.getByRole('button', { name: `Replay duplicate.csv (${A.slice(0, 8)})`, exact: true }).click();
  await expect(page.getByLabel('Current recording')).toContainText(A);
  let deletes = 0;
  await page.route(`**/api/datasets/${A}`, route => { if (route.request().method() !== 'DELETE') return route.fulfill({ json: recording() }); deletes++; return route.fulfill({ json: { dataset_id: A, deleted: true } }); });
  await remove(page, A).click();
  await page.route('**/api/meta', route => route.fulfill({ status: 503, json: { detail: 'metadata offline' } }));
  await confirmation(page).getByRole('button', { name: 'Switch to built-in assignment' }).click();
  await expect(confirmation(page).getByRole('alert')).toContainText('metadata offline');
  await expect(page.getByLabel('Current recording')).toContainText(A);
  await expect(confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true })).toBeDisabled();
  expect(deletes).toBe(0);
  await page.route('**/api/meta', route => route.fulfill({ json: metadata }));
  await page.routeWebSocket('**/ws/replay', route => route.close());
  await confirmation(page).getByRole('button', { name: 'Switch to built-in assignment' }).click();
  await expect(confirmation(page).getByRole('button', { name: 'Reconnect built-in assignment' })).toBeEnabled();
  await expect(confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true })).toBeDisabled();
  expect(deletes).toBe(0);
  await page.routeWebSocket('**/ws/replay', route => route.send(JSON.stringify(initial)));
  await confirmation(page).getByRole('button', { name: 'Reconnect built-in assignment' }).click();
  await expect(confirmation(page)).toContainText('Built-in assignment loaded');
  await confirmation(page).getByRole('button', { name: 'Permanently delete', exact: true }).click();
  expect(deletes).toBe(1); expect(server.errors).toEqual([]);
});
