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
  await expect(page.getByRole('button', { name: 'Import in progress…' })).toBeDisabled();
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
  await input.evaluate(element => {
    const file = new File(['large'], 'large.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 + 1 });
    const transfer = new DataTransfer(); transfer.items.add(file);
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(alert).toHaveCount(0);
  await upload.click();
  await expect(alert).toContainText('50 MiB');
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

test('upload limits come from backend settings and failure has explicit recovery', async ({ page }) => {
  await setup(page);
  await page.route('**/api/upload-limits', route => route.fulfill({ status: 503, json: { detail: 'offline' } }));
  await page.reload();
  await page.getByText('Upload CSV', { exact: true }).click();
  await expect(page.locator('.upload-section').getByRole('alert')).toContainText('Upload limits unavailable');
  await page.getByLabel('CSV file').setInputFiles({ name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('12345') });
  await expect(page.getByRole('button', { name: 'Upload and store' })).toBeDisabled();
  await page.route('**/api/upload-limits', route => route.fulfill({ json: { max_bytes: 4, max_rows: 2 } }));
  await page.getByRole('button', { name: 'Retry upload limits' }).click();
  await expect(page.locator('.upload-help')).toContainText('4 bytes / 2 rows');
  await page.getByRole('button', { name: 'Upload and store' }).click();
  await expect(page.locator('.upload-section').getByRole('alert')).toContainText('4 byte');
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeEnabled();
});

test('default limit display and exact client byte boundary permit submission', async ({ page }) => {
  await setup(page);
  await page.getByText('Upload CSV', { exact: true }).click();
  await expect(page.locator('.upload-help')).toContainText('UTF-8 CSV · Up to 50 MiB / 1,000,000 rows');
  let posts = 0;
  await page.route('**/api/datasets', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    posts++; return route.fulfill({ status: 201, json: result });
  });
  await page.getByLabel('CSV file').evaluate(element => {
    const file = new File(['csv'], 'boundary.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: 52428800 });
    const transfer = new DataTransfer(); transfer.items.add(file);
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Upload and store' }).click();
  await expect(page.locator('.upload-result')).toContainText('2 accepted rows / 3 source rows');
  expect(posts).toBe(1);
});

// Controlled native XHR events verify UI boundaries; real transfer checks are separate.
async function controlledUploads(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.assign(window, { testUploads: [] as XMLHttpRequest[] });
    XMLHttpRequest.prototype.send = function () {
      (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads.push(this);
    };
    XMLHttpRequest.prototype.abort = function () { this.dispatchEvent(new Event('abort')); };
  });
  await setup(page);
  await page.getByText('Upload CSV', { exact: true }).click();
  await page.getByLabel('CSV file').setInputFiles({ name: 'stages.csv', mimeType: 'text/csv', buffer: Buffer.from('csv') });
}
async function respond(page: import('@playwright/test').Page, index: number, status: number, body: unknown) {
  await page.evaluate(({ index, status, body }) => {
    const request = (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads[index];
    Object.defineProperty(request, 'status', { value: status, configurable: true });
    Object.defineProperty(request, 'response', { value: body, configurable: true });
    request.dispatchEvent(new Event('load'));
  }, { index, status, body });
}

test('transfer percentage is distinct from indeterminate processing and confirmed completion', async ({ page }) => {
  await controlledUploads(page);
  await page.getByRole('button', { name: 'Upload and store' }).click();
  const transfer = page.getByRole('progressbar', { name: 'Upload transfer', exact: true });
  await expect(transfer).not.toHaveAttribute('value');
  await page.evaluate(() => {
    const request = (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads[0];
    request.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 25, total: 100 }));
  });
  await expect(transfer).toHaveAttribute('value', '25');
  await expect(page.locator('.upload-feedback')).toContainText('25% of transfer sent');
  await page.locator('.upload-section form').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads.length)).toBe(1);
  await page.evaluate(() => {
    const request = (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads[0];
    request.upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 100, total: 100 }));
  });
  // A measured 100% transfer must enter processing even if upload.load is delayed.
  await expect(page.getByRole('progressbar', { name: 'Processing and saving Parquet' })).not.toHaveAttribute('value');
  await expect(page.locator('.upload-result')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads[0].upload.dispatchEvent(new Event('load')));
  await expect(page.locator('.upload-feedback')).toContainText('Processing and validating CSV, then saving Parquet');
  await expect(page.getByRole('progressbar', { name: 'Processing and saving Parquet' })).not.toHaveAttribute('value');
  await expect(page.getByLabel('CSV file')).toBeDisabled();
  await expect(page.locator('.upload-result')).toHaveCount(0);
  await respond(page, 0, 201, result);
  await expect(page.locator('.upload-result')).toContainText('Completed · Stored other.csv');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload and store' })).toBeEnabled();
});

test('cancel in transfer or processing permits retry and ignores late events from the old request', async ({ page }) => {
  await controlledUploads(page);
  for (const stage of ['transfer', 'processing']) {
    await page.getByRole('button', { name: 'Upload and store' }).click();
    if (stage === 'processing') await page.evaluate(() => {
      (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads.at(-1)!.upload.dispatchEvent(new Event('load'));
    });
    await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
    await expect(page.locator('.upload-feedback')).toContainText('Import cancelled');
    await expect(page.getByRole('button', { name: 'Upload and store' })).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Upload and store' }).click();
  await respond(page, 0, 201, result); // Old success must not refresh or replace retry state.
  await page.evaluate(() => {
    const old = (window as unknown as { testUploads: XMLHttpRequest[] }).testUploads[1];
    old.upload.dispatchEvent(new Event('load')); old.dispatchEvent(new Event('error')); old.dispatchEvent(new Event('abort'));
  });
  await expect(page.getByRole('button', { name: 'Import in progress…' })).toBeDisabled();
  await expect(page.locator('.upload-result')).toHaveCount(0);
  await expect(page.locator('.upload-section').getByRole('alert')).toHaveCount(0);
  await respond(page, 2, 201, result);
  await expect(page.locator('.upload-result')).toContainText('Completed');
});

test('row-limit, busy-import and unconfirmed-response errors preserve a retryable form', async ({ page }) => {
  await controlledUploads(page);
  const cases = [
    { status: 413, body: { detail: 'CSV exceeds the 1,000,000 source-row limit.' }, message: '1,000,000 source-row limit' },
    { status: 409, body: { detail: 'Another import is running. Try again when it finishes.' }, message: 'Another import is running' },
    { status: 201, body: null, message: 'import may have completed' },
    { status: 504, body: null, message: 'Refresh recordings before retrying' },
  ];
  for (const [index, entry] of cases.entries()) {
    await page.getByRole('button', { name: 'Upload and store' }).click();
    await respond(page, index, entry.status, entry.body);
    await expect(page.locator('.upload-section').getByRole('alert')).toContainText(entry.message);
    await expect(page.getByRole('button', { name: 'Upload and store' })).toBeEnabled();
    await expect(page.getByLabel('CSV file')).toBeEnabled();
  }
});
