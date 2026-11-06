import { expect, test, type Page } from '@playwright/test';
import { initial, setup, vessel } from './fixtures';

const clock = (page: Page) => page.locator('time[aria-label="Current replay time"]');
const stateAt = (second: number, playing = false, speed: 1 | 2 | 5 | 10 = 1) => ({
  ...initial, second, playing, speed,
  timestamp: new Date(Date.parse(initial.timestamp) + second * 1000).toISOString(),
});

async function rangeInput(page: Page, value: number) {
  // The native setter and input event simulate a range value change (range has no text field).
  await page.getByRole('slider', { name: 'Replay position' }).evaluate((element, second) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(second));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('play/pause, all supported speeds and reset use confirmed state without resetting time', async ({ page }) => {
  const server = await setup(page);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  server.send(stateAt(100, true));
  await expect(clock(page)).toHaveText('09:01:40');
  for (const speed of ['2', '5', '10', '1']) {
    await page.getByRole('combobox', { name: 'Playback speed' }).selectOption(speed);
    await expect(page.getByRole('combobox')).toBeEnabled();
    await expect(page.getByRole('combobox')).toHaveValue(speed);
    await expect(clock(page)).toHaveText('09:01:40');
  }
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(clock(page)).toHaveText('09:00:00');
  await expect(page.getByRole('slider')).toHaveValue('0');
  expect(server.commands).toEqual([{ type: 'play' }, ...[2, 5, 10, 1].map(speed => ({ type: 'set_speed', speed })),
    { type: 'pause' }, { type: 'reset' }]);
  expect(server.connections()).toBe(1);
});

test('seek forward/backward and native keyboard boundaries stop correctly at the end', async ({ page }) => {
  const server = await setup(page);
  await rangeInput(page, 600);
  await expect(clock(page)).toHaveText('09:10:00');
  await expect(page.getByRole('slider')).toBeEnabled();
  await rangeInput(page, 20);
  await expect(clock(page)).toHaveText('09:00:20');
  await expect(page.getByRole('slider')).toBeEnabled();
  await page.getByRole('slider').press('End');
  await expect(clock(page)).toHaveText('09:29:59');
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Playback controls' })).toContainText('Finished');
  await page.getByRole('slider').press('Home');
  await expect(clock(page)).toHaveText('09:00:00');
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  expect(server.commands).toEqual([600, 20, 1799, 0].map(second => ({ type: 'seek', second })));
});

test('dragging ignores live slider updates and uses a pause/seek/resume acknowledgement barrier', async ({ page }) => {
  const server = await setup(page, { autoRespond: false });
  server.send(stateAt(100, true));
  await expect(page.getByRole('slider')).toHaveValue('100');
  const slider = page.getByRole('slider');
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 8 + (box.width - 16) * 100 / 1799, box.y + box.height / 2);
  await page.mouse.down();
  await rangeInput(page, 600);
  server.send(stateAt(130, true));
  await expect(clock(page)).toHaveText('09:02:10');
  await expect(slider).toHaveValue('600');
  expect(server.commands).toEqual([]);
  await page.mouse.up();
  await expect.poll(() => server.commands).toEqual([{ type: 'pause' }]);
  server.send(stateAt(600, true)); // A matching old progress second must NOT acknowledge the seek.
  await expect(clock(page)).toHaveText('09:10:00');
  expect(server.commands).toEqual([{ type: 'pause' }]);
  await expect(slider).toBeDisabled();
  server.send(stateAt(131, false));
  await expect.poll(() => server.commands).toEqual([{ type: 'pause' }, { type: 'seek', second: 600 }]);
  server.send(stateAt(131, false)); // Ignore an unrelated paused frame while awaiting target.
  await expect(slider).toHaveValue('600');
  server.send(stateAt(600, false));
  await expect.poll(() => server.commands).toEqual([{ type: 'pause' }, { type: 'seek', second: 600 }, { type: 'play' }]);
  server.send(stateAt(600, true));
  await expect(slider).toBeEnabled();
  await expect(slider).toHaveValue('600');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeEnabled();
  server.send(stateAt(601, true));
  await expect(slider).toHaveValue('601');
  expect(server.errors).toEqual([]);
});

test('speed selector waits for confirmation rather than displaying optimistic speed', async ({ page }) => {
  const server = await setup(page, { autoRespond: false });
  server.send(stateAt(10, true));
  await expect(clock(page)).toHaveText('09:00:10');
  await page.getByRole('combobox').selectOption('5');
  await expect(page.getByRole('combobox')).toHaveValue('1');
  await expect(page.getByRole('combobox')).toBeDisabled();
  server.send(stateAt(11, true));
  await expect(page.getByRole('combobox')).toHaveValue('1');
  server.send(stateAt(11, true, 5));
  await expect(page.getByRole('combobox')).toHaveValue('5');
  await expect(page.getByRole('combobox')).toBeEnabled();
  await expect(clock(page)).toHaveText('09:00:11');
});

test('delayed acknowledgements preserve range and speed keyboard focus without accepting extra input', async ({ page }) => {
  const server = await setup(page, { autoRespond: false });
  const slider = page.getByRole('slider');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => server.commands).toEqual([{ type: 'seek', second: 1 }]);
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowRight'); // Busy: no second seek yet.
  expect(server.commands).toHaveLength(1);
  server.send(stateAt(1));
  await expect(slider).toBeEnabled();
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowRight'); // No locator.press refocuses it for us.
  await expect.poll(() => server.commands).toHaveLength(2);
  expect(server.commands[1]).toEqual({ type: 'seek', second: 2 });
  server.send(stateAt(2));
  await expect(slider).toBeEnabled();

  const speed = page.getByRole('combobox');
  await speed.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => server.commands).toHaveLength(3);
  expect(server.commands[2]).toEqual({ type: 'set_speed', speed: 2 });
  await expect(speed).toBeFocused();
  await page.keyboard.press('ArrowDown');
  expect(server.commands).toHaveLength(3);
  server.send(stateAt(2, false, 2));
  await expect(speed).toBeEnabled();
  await expect(speed).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => server.commands).toHaveLength(4);
  expect(server.commands[3]).toEqual({ type: 'set_speed', speed: 5 });
  server.send(stateAt(2, false, 5));
  await expect(speed).toHaveValue('5');
});

test('selected vessel values follow observations and disappear during a gap or disconnect', async ({ page }) => {
  const server = await setup(page);
  const panel = page.getByRole('complementary', { name: 'Vessel details' });
  await expect(panel).toContainText('Select a vessel on the map.');
  await page.getByTitle('Vessel T012').click();
  await expect(panel).toContainText('5.00 knots');
  await expect(panel).toContainText('90.0°');
  await expect(panel).toContainText('13.055000°');
  await expect(panel).toContainText('80.320000°');
  await expect(panel.locator('time')).toHaveText('09:00:00');
  server.send({ ...stateAt(600), vessels: [initial.vessels[0]] });
  await expect(panel).toContainText('T012');
  await expect(panel).toContainText('No observation at this time.');
  await expect(panel.locator('dd')).toHaveCount(0);
  const changed = { ...vessel('T012', 13.065, 80.325, 180), speed_knots: 6.3 };
  server.send({ ...stateAt(640), vessels: [initial.vessels[0], changed] });
  await expect(panel).toContainText('6.30 knots');
  await expect(panel).toContainText('180.0°');
  await expect(panel.locator('time')).toHaveText('09:10:40');
  server.close();
  await expect(panel).toContainText('Current observation unavailable');
  await expect(panel.locator('dd')).toHaveCount(0);
});

test('disconnect cancels pending seek and reconnect does not retain its draft or deadline', async ({ page }) => {
  const server = await setup(page, { autoRespond: false });
  await page.clock.install();
  await rangeInput(page, 300);
  await expect(page.getByRole('slider')).toBeDisabled();
  server.close();
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await expect(page.getByRole('slider')).toHaveValue('0');
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();
  await page.clock.fastForward(6000);
  await expect(page.getByRole('status', { name: 'Replay connection' })).toHaveText('connected');
  await expect(page.getByRole('slider')).toBeEnabled();
  expect(server.connections()).toBe(2);
});

test('unacknowledged commands time out visibly and do not freeze controls indefinitely', async ({ page }) => {
  await setup(page, { autoRespond: false });
  await page.clock.install();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByRole('button', { name: 'Reset' })).toBeDisabled();
  await page.clock.fastForward(5001);
  await expect(page.getByRole('alert')).toContainText('Replay command timed out');
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await expect(page.locator('.vessel-marker')).toHaveCount(0);
});
