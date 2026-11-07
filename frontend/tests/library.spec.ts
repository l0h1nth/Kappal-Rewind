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
