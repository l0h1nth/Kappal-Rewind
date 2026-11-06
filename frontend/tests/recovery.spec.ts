import { expect, test } from '@playwright/test';
import { initial, setup } from './fixtures';

for (const [label, text] of [
  ['invalid JSON', '{broken'],
  ['invalid fields', JSON.stringify({ ...initial, vessels: [{ ...initial.vessels[0], lat: 400 }] })],
]) {
test(`a malformed paused frame (${label}) offers reconnect without another server frame`, async ({ page }) => {
  const server = await setup(page, { autoRespond: false });
  await page.clock.install();
  // Also discard the pending command's deadline when terminating the broken session.
  await page.getByRole('slider').press('ArrowRight');
  server.sendRaw(text);
  await expect(page.getByRole('alert')).toContainText('Invalid replay message');
  await expect(page.locator('.vessel-marker')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await page.clock.fastForward(6000);
  await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('connected');
  await expect(page.getByRole('slider')).toHaveValue('0');
  expect(server.connections()).toBe(2);
  expect(server.errors).toEqual([]);
});
}

test('an open socket without its first state times out and can reconnect', async ({ page }) => {
  await page.clock.install();
  const server = await setup(page, { sendInitial: false });
  server.send({ type: 'error', message: 'No state yet' });
  await expect(page.getByRole('alert')).toContainText('No state yet');
  await page.clock.fastForward(8001);
  await expect(page.getByRole('alert')).toContainText('Replay connection timed out');
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect.poll(() => server.connections()).toBe(2);
  server.send(initial);
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await page.clock.fastForward(9000); // A successful first frame cancels the new deadline.
  await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('connected');
  expect(server.errors).toEqual([]);
});
