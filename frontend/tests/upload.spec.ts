import { expect, test } from '@playwright/test';
import { setup } from './fixtures';

const result = {
  dataset_id: 'abc123', original_filename: 'other.csv', accepted_row_count: 2,
  vessel_count: 1, duration_seconds: 3, start: '2025-01-01T00:00:00Z', end: '2025-01-01T00:00:02Z',
  validation: { source_row_count: 3, discarded_row_count: 1, heading_normalizations: 1,
    missing_observation_seconds: 1, naive_timezone: 'UTC' },
};

test('upload progress and validation leave the replay session unchanged', async ({ page }) => {
  const replay = await setup(page);
  let release: () => void = () => {};
  let body = '';
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/datasets', async route => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: [] }); return; }
    expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=');
    body = route.request().postData() ?? '';
    await wait;
    await route.fulfill({ status: 201, json: result });
  });
  await page.getByText('Upload CSV', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Upload and store' })).toBeDisabled();
  await page.getByLabel('CSV file').setInputFiles({ name: 'other.csv', mimeType: 'text/csv', buffer: Buffer.from('csv-content') });
  await expect(page.locator('.upload-section')).toContainText('other.csv');
  await page.getByRole('button', { name: 'Upload and store' }).click();
  await expect(page.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
  await page.getByRole('button', { name: '▶ Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  release();
  await expect(page.locator('.upload-result')).toContainText('2 accepted rows / 3 source rows');
  await expect(page.locator('.upload-result')).toContainText('1 duplicate rows discarded');
  await expect(page.locator('.upload-result')).toContainText('timezone: UTC');
  expect(body).toContain('name="file"; filename="other.csv"');
  expect(body).toContain('csv-content');
  expect(replay.connections()).toBe(1);
  await expect(page.locator('.vessel-marker')).toHaveCount(2);
  expect(replay.errors).toEqual([]);
});

test('upload errors are local and selecting another file clears them', async ({ page }) => {
  const replay = await setup(page);
  await page.getByText('Upload CSV', { exact: true }).click();
  const input = page.getByLabel('CSV file');
  const upload = page.getByRole('button', { name: 'Upload and store' });
  const alert = page.locator('.upload-section').getByRole('alert');
  await page.route('**/api/datasets', route => route.fulfill({ status: 422, json: { detail: 'CSV line 2: lat must be finite' } }));
  await input.setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('bad') });
  await upload.click();
  await expect(alert).toContainText('CSV line 2: lat');
  await input.setInputFiles({ name: 'large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(alert).toHaveCount(0);
  await upload.click();
  await expect(alert).toContainText('10 MiB');
  await input.setInputFiles({ name: 'normal.csv', mimeType: 'text/csv', buffer: Buffer.from('normal') });
  await page.route('**/api/datasets', route => route.fulfill({ status: 413, body: '<html>Too large</html>' }));
  await upload.click();
  await expect(alert).toContainText('server size limit');
  await page.route('**/api/datasets', route => route.abort());
  await upload.click();
  await expect(alert).toBeVisible();
  await expect(upload).toBeEnabled();
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeEnabled();
  expect(replay.connections()).toBe(1);
  expect(replay.errors).toEqual([]);
});
